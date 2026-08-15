#!/usr/bin/env node
/**
 * Contrasta el mundialito que calcula la base contra una implementacion
 * independiente de las reglas.
 *
 * El formato del mundialito es un plegado con reinicio —el estado de un partido
 * depende del anterior— y en SQL eso vive en un CTE recursivo con CASE anidados
 * (vMundialitoRuns). Ese es exactamente el tipo de codigo donde un error no se
 * nota: no revienta, devuelve otro numero.
 *
 * Por eso este script NO traduce el SQL a JavaScript. Escribe las reglas de
 * cero, en la forma mas obvia posible —un for sobre los partidos de cada
 * jugador—, y compara partido por partido. Si las dos implementaciones
 * coinciden en 700 filas, el CTE hace lo que dice.
 *
 * Las reglas, para que se puedan leer sin abrir el SQL:
 *   - Cuentan los partidos de torneos con detalle registrado (wasTracked),
 *     en orden cronologico y sin importar de que torneo sean.
 *   - Un mundialito son 8 partidos: 3 de grupos y 5 de eliminacion directa
 *     (16avos, 8avos, 4tos, semis, final). Se paga 3 / 1 / 0.
 *   - En grupos hacen falta 4 puntos. Si ni ganando todo lo que le queda llega
 *     a esa cuenta, queda afuera ahi mismo y no juega el resto de la fase.
 *   - Desde los 16avos, perder elimina; empatar o ganar pasa de ronda.
 *   - Pasar de ronda en la final es salir campeon.
 *   - Eliminado o campeon, el siguiente partido arranca un mundialito nuevo.
 *
 * Uso: node scripts/verify-mundialito.mjs
 */
import { createConnection } from 'mysql2/promise';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

loadDotEnv(join(ROOT, '.env'));

/** Parser minimo de .env: solo `CLAVE=valor`, sin export ni multilinea. */
function loadDotEnv(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] === undefined) {
      process.env[key] = rawValue.replace(/^["']|["']$/g, '').trim();
    }
  }
}

const SLOTS = 8;
const GROUP_SLOTS = 3;
const GROUP_TARGET = 4;
const POINTS = { W: 3, D: 1, L: 0 };
const PHASE_BY_SLOT = ['GROUP', 'GROUP', 'GROUP', 'R16', 'R8', 'R4', 'SF', 'F'];

/**
 * Las reglas, escritas de la forma mas aburrida posible.
 *
 * Recibe los partidos de UN jugador ya ordenados y devuelve una fila por
 * partido con el mundialito, el puesto y como termino.
 */
function runMundialito(matches) {
  const rows = [];

  let runIndex = 1;
  let slot = 0;
  let groupPoints = 0;

  for (const match of matches) {
    slot += 1;
    const points = POINTS[match.result];

    if (slot <= GROUP_SLOTS) groupPoints += points;

    let outcome = 'ALIVE';
    if (slot <= GROUP_SLOTS) {
      // Lo mejor que puede terminar: lo que lleva mas ganar todo lo que queda.
      const bestPossible = groupPoints + POINTS.W * (GROUP_SLOTS - slot);
      if (bestPossible < GROUP_TARGET) outcome = 'OUT';
    } else {
      if (match.result === 'L') outcome = 'OUT';
      else if (slot === SLOTS) outcome = 'CHAMPION';
    }

    rows.push({
      playerId: match.playerId,
      matchId: match.matchId,
      // El resultado viaja en la fila porque las metricas de rendimiento se
      // recalculan desde aca: sin el, "supero la ronda" da siempre que si.
      result: match.result,
      runIndex,
      slot,
      groupPoints,
      outcome,
      phase: PHASE_BY_SLOT[slot - 1],
    });

    // Cerrada la corrida, el proximo partido empieza de nuevo.
    if (outcome !== 'ALIVE') {
      runIndex += 1;
      slot = 0;
      groupPoints = 0;
    }
  }

  return rows;
}

async function main() {
  const rootPassword = process.env.MYSQL_ROOT_PASSWORD;
  const connection = await createConnection({
    host: process.env.MYSQL_HOST ?? 'localhost',
    port: Number(process.env.MYSQL_PORT ?? 3306),
    user: rootPassword ? 'root' : (process.env.MYSQL_USER ?? 'root'),
    password: rootPassword ?? process.env.MYSQL_PASSWORD ?? '',
    database: process.env.MYSQL_DATABASE ?? 'murieron_en_madrid',
  });

  try {
    // La secuencia cruda: los mismos partidos que mira la vista, sin nada
    // calculado encima.
    const [sequence] = await connection.query(`
      SELECT r.playerId, r.matchId, r.playedAt, r.result
      FROM vMatchPlayerResults r
      INNER JOIN Tournaments t ON t.tournamentId = r.tournamentId
      WHERE t.wasTracked = TRUE
      ORDER BY r.playerId, r.playedAt, r.matchId
    `);

    const [actual] = await connection.query(`
      SELECT playerId, matchId, runIndex, slot, groupPoints, outcome, phase
      FROM vMundialitoRuns
      ORDER BY playerId, runIndex, slot
    `);

    const byPlayer = new Map();
    for (const match of sequence) {
      if (!byPlayer.has(match.playerId)) byPlayer.set(match.playerId, []);
      byPlayer.get(match.playerId).push(match);
    }

    const expected = [...byPlayer.values()].flatMap((matches) => runMundialito(matches));

    const problems = [];

    if (expected.length !== actual.length) {
      problems.push(
        `cantidad de filas: esperadas ${expected.length}, obtenidas ${actual.length}`,
      );
    }

    const actualByMatch = new Map(
      actual.map((row) => [`${row.playerId}:${row.matchId}`, row]),
    );

    for (const row of expected) {
      const key = `${row.playerId}:${row.matchId}`;
      const found = actualByMatch.get(key);

      if (!found) {
        problems.push(`falta la fila ${key}`);
        continue;
      }

      for (const field of ['runIndex', 'slot', 'groupPoints', 'outcome', 'phase']) {
        if (found[field] !== row[field]) {
          problems.push(
            `${key} mundialito ${row.runIndex} puesto ${row.slot}: ` +
              `${field} esperado ${row[field]}, obtenido ${found[field]}`,
          );
        }
      }
    }

    // El estado que muestra la card sale de otra vista (vMundialitoCurrent) y
    // tiene que ser el de la ultima corrida: verificarlo aparte es barato y es
    // justo lo que se ve en pantalla.
    const [current] = await connection.query(`
      SELECT playerId, runIndex, played, status FROM vMundialitoCurrent
    `);

    const lastByPlayer = new Map();
    for (const row of expected) {
      const last = lastByPlayer.get(row.playerId);
      if (!last || row.runIndex > last.runIndex || row.slot > last.slot) {
        lastByPlayer.set(row.playerId, row);
      }
    }

    for (const row of current) {
      const last = lastByPlayer.get(row.playerId);
      if (!last) {
        problems.push(`jugador ${row.playerId}: la vista lo muestra y no deberia`);
        continue;
      }
      if (row.runIndex !== last.runIndex || row.status !== last.outcome) {
        problems.push(
          `jugador ${row.playerId}: corrida vigente esperada ` +
            `#${last.runIndex}/${last.outcome}, obtenida #${row.runIndex}/${row.status}`,
        );
      }
      if (row.played !== last.slot) {
        problems.push(
          `jugador ${row.playerId}: partidos jugados esperados ${last.slot}, ` +
            `obtenidos ${row.played}`,
        );
      }
    }

    // Las metricas de rendimiento (vMundialitoPlayerStats) son agregaciones
    // sobre el mismo plegado, asi que se pueden recalcular desde `expected` sin
    // volver a mirar la base. Se verifican porque una agregacion equivocada no
    // rompe nada: devuelve otro numero y nadie se entera.
    const [stats] = await connection.query(`
      SELECT playerId, runsEnded, qualified, koPlayed, koPassed, semis, finals,
             titles, eliminations, bestSlot, droughtRuns, perfectRuns
      FROM vMundialitoPlayerStats
      WHERE matchesPlayed > 0
    `);

    const expectedStats = new Map();
    for (const row of expected) {
      const acc = expectedStats.get(row.playerId) ?? {
        runsEnded: 0,
        qualified: 0,
        koPlayed: 0,
        koPassed: 0,
        semis: 0,
        finals: 0,
        titles: 0,
        eliminations: 0,
        bestSlot: 0,
        lastRun: 0,
        lastQualifiedRun: 0,
        perfectRuns: 0,
        runWins: new Map(),
        runLengths: new Map(),
      };

      if (row.slot > GROUP_SLOTS) {
        acc.koPlayed += 1;
        if (row.result !== 'L') acc.koPassed += 1;
        if (row.slot === 7) acc.semis += 1;
        if (row.slot === 8) acc.finals += 1;
      }

      acc.bestSlot = Math.max(acc.bestSlot, row.slot);
      acc.runLengths.set(row.runIndex, row.slot);
      if (row.result === 'W') {
        acc.runWins.set(row.runIndex, (acc.runWins.get(row.runIndex) ?? 0) + 1);
      }

      if (row.outcome !== 'ALIVE') {
        acc.runsEnded += 1;
        acc.lastRun = row.runIndex;
        if (row.outcome === 'CHAMPION') acc.titles += 1;
        else acc.eliminations += 1;
        // Clasificar es haber llegado al puesto 4, se haya muerto ahi o despues.
        if (row.slot >= 4) {
          acc.qualified += 1;
          acc.lastQualifiedRun = row.runIndex;
        }
      }

      expectedStats.set(row.playerId, acc);
    }

    for (const [playerId, acc] of expectedStats) {
      for (const [runIndex, length] of acc.runLengths) {
        if (length === SLOTS && acc.runWins.get(runIndex) === SLOTS) acc.perfectRuns += 1;
      }
      acc.droughtRuns = acc.lastRun - acc.lastQualifiedRun;
      expectedStats.set(playerId, acc);
    }

    for (const row of stats) {
      const acc = expectedStats.get(row.playerId);
      if (!acc) {
        problems.push(`stats: el jugador ${row.playerId} no deberia tener fila`);
        continue;
      }
      for (const field of [
        'runsEnded',
        'qualified',
        'koPlayed',
        'koPassed',
        'semis',
        'finals',
        'titles',
        'eliminations',
        'bestSlot',
        'droughtRuns',
        'perfectRuns',
      ]) {
        if (Number(row[field]) !== acc[field]) {
          problems.push(
            `stats jugador ${row.playerId}: ${field} esperado ${acc[field]}, ` +
              `obtenido ${row[field]}`,
          );
        }
      }
    }

    console.log(`[verify] ${expected.length} partidos en ${byPlayer.size} jugadores`);
    console.log(`[verify] ${current.length} corridas vigentes`);
    console.log(`[verify] ${stats.length} filas de rendimiento`);

    if (problems.length > 0) {
      console.error(`[verify] ${problems.length} DIFERENCIAS:`);
      for (const problem of problems.slice(0, 40)) console.error(`  - ${problem}`);
      if (problems.length > 40) console.error(`  ... y ${problems.length - 40} mas`);
      process.exitCode = 1;
      return;
    }

    console.log('[verify] OK: el mundialito de la base coincide con las reglas');
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(`[verify] ERROR: ${error.message}`);
  process.exit(1);
});
