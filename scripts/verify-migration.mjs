#!/usr/bin/env node
/**
 * Compara las tablas que calcula la base contra las que calculaba el sistema
 * viejo.
 *
 * Reimplementa, literalmente, el algoritmo de computeTournament/computeGeneral
 * de docs/index.html sobre el JSON original, y contrasta fila por fila con lo
 * que devuelven vTournamentStandings y vGeneralStandings.
 *
 * Es la prueba de que la migracion no cambio un solo punto: si el motor de
 * calculo en SQL difiere del de JavaScript aunque sea en un decimal, esto lo
 * marca.
 *
 * Uso: node scripts/verify-migration.mjs
 */
import { createConnection } from 'mysql2/promise';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, '..', 'docs', 'Codigo.gs');

loadDotEnv(join(ROOT, '.env'));

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

function readLegacyData() {
  const source = readFileSync(SOURCE, 'utf8');
  const match = source.match(/var SEED = ("(?:[^"\\]|\\.)*");/s);
  return JSON.parse(JSON.parse(match[1]));
}

// ─── Algoritmo original, copiado de docs/index.html ───────────────────────────
// No se "mejora" nada a proposito: el valor de esta verificacion esta en que
// sea el mismo codigo que producia las tablas que el grupo ya vio.

function emptyRow() {
  return { played: 0, won: 0, drew: 0, lost: 0, dif: 0 };
}

function applyMatch(r, dif) {
  r.played += 1;
  r.dif += dif;
  if (dif > 0) r.won += 1;
  else if (dif < 0) r.lost += 1;
  else r.drew += 1;
}

function cmpStanding(a, b) {
  return b.net - a.net || (b.dif || 0) - (a.dif || 0) || (b.wr || 0) - (a.wr || 0);
}

function computeTournament(t) {
  const acc = {};
  const get = (pid) => {
    if (!acc[pid]) acc[pid] = { ...emptyRow(), dif: 0 };
    return acc[pid];
  };

  Object.entries(t.baseline || {}).forEach(([pid, b]) => {
    const r = get(pid);
    r.played += b.played || 0;
    r.won += b.won || 0;
    r.drew += b.drew || 0;
    r.lost += b.lost || 0;
    r.dif += b.dif || 0;
  });

  (t.matches || []).forEach((m) => {
    if (m.programado) return;
    const dif = m.ganador === 'oscuro' ? m.dif || 0 : m.ganador === 'claro' ? -(m.dif || 0) : 0;
    (m.oscuro || []).forEach((pid) => applyMatch(get(pid), dif));
    (m.claro || []).forEach((pid) => applyMatch(get(pid), -dif));
  });

  const sc = t.scoring;
  const pen = t.pen || {};
  const rows = Object.entries(acc).map(([pid, r]) => {
    const points = sc.win * r.won + sc.draw * r.drew + sc.loss * r.lost;
    const maxPoints = sc.win * r.played;
    return {
      pid,
      ...r,
      points,
      maxPoints,
      wr: maxPoints ? points / maxPoints : null,
      pen: pen[pid] || 0,
      net: points - (pen[pid] || 0),
    };
  });
  rows.sort(cmpStanding);
  return rows;
}

function computeGeneral(data) {
  const acc = {};
  data.tournaments.forEach((t) => {
    computeTournament(t).forEach((r) => {
      if (!acc[r.pid]) {
        acc[r.pid] = { ...emptyRow(), dif: 0, points: 0, maxPoints: 0, tpen: 0 };
      }
      const a = acc[r.pid];
      a.played += r.played;
      a.won += r.won;
      a.drew += r.drew;
      a.lost += r.lost;
      a.dif += r.dif || 0;
      a.points += r.points;
      a.maxPoints += r.maxPoints;
      a.tpen += r.pen;
    });
  });

  const pen = data.generalPen || {};
  const rows = Object.entries(acc).map(([pid, r]) => {
    const gp = pen[pid] || 0;
    return {
      pid,
      ...r,
      wr: r.maxPoints ? r.points / r.maxPoints : null,
      pen: gp,
      net: r.points - r.tpen - gp,
    };
  });
  rows.sort(cmpStanding);
  return rows;
}

// ─── Comparacion ──────────────────────────────────────────────────────────────

const EPSILON = 1e-9;

function near(a, b) {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return Math.abs(Number(a) - Number(b)) < EPSILON;
}

async function main() {
  const data = readLegacyData();

  const connection = await createConnection({
    host: process.env.MYSQL_HOST ?? 'localhost',
    port: Number(process.env.MYSQL_PORT ?? 3306),
    user: process.env.MYSQL_USER ?? 'mem',
    password: process.env.MYSQL_PASSWORD ?? '',
    database: process.env.MYSQL_DATABASE ?? 'murieron_en_madrid',
  });

  const problems = [];
  const ties = [];

  try {
    // El sistema viejo identificaba por apodo; el nuevo por id. El apodo es el
    // puente: el seed lo guarda tal cual venia.
    const [players] = await connection.query(
      'SELECT playerId, nickname FROM Players',
    );
    const nameById = new Map(players.map((p) => [p.playerId, p.nickname]));
    const legacyNameById = new Map(data.players.map((p) => [p.id, p.name]));

    const [tournaments] = await connection.query(
      'SELECT tournamentId, `name` FROM Tournaments ORDER BY startedAt',
    );

    for (const legacyTournament of data.tournaments) {
      const row = tournaments.find((t) => t.name === legacyTournament.name);
      if (!row) {
        problems.push(`falta el torneo "${legacyTournament.name}"`);
        continue;
      }

      const expected = computeTournament(legacyTournament);
      const [actual] = await connection.query('CALL GetTournamentScoreboard(?)', [
        row.tournamentId,
      ]);
      const actualRows = actual[0];

      compare(
        `torneo "${legacyTournament.name}"`,
        expected,
        actualRows,
        legacyNameById,
        nameById,
        problems,
        ties,
      );
    }

    const expectedGeneral = computeGeneral(data);
    const [actualGeneral] = await connection.query('CALL GetGeneralScoreboard()');
    compare(
      'tabla historica',
      expectedGeneral,
      actualGeneral[0],
      legacyNameById,
      nameById,
      problems,
      ties,
    );

    // Los campeones tambien tienen que coincidir.
    for (const legacyTournament of data.tournaments) {
      if (legacyTournament.estado !== 'finalizado') continue;
      const expectedChampion = legacyNameById.get(computeTournament(legacyTournament)[0].pid);
      const [rows] = await connection.query(
        'SELECT championName FROM vTournamentDetail WHERE `name` = ?',
        [legacyTournament.name],
      );
      const actualChampion = rows[0]?.championName;
      if (expectedChampion !== actualChampion) {
        problems.push(
          `campeon de "${legacyTournament.name}": esperado ${expectedChampion}, ` +
            `obtenido ${actualChampion}`,
        );
      }
    }
  } finally {
    await connection.end();
  }

  if (ties.length > 0) {
    process.stdout.write(
      `[verify] ${ties.length} diferencias de orden entre jugadores empatados ` +
        '(mismos puntos, misma diferencia, mismo winrate). No son errores: el ' +
        'sistema viejo los ordenaba de forma arbitraria y el nuevo desempata ' +
        'por id, que es estable.\n',
    );
    for (const tie of ties) {
      process.stdout.write(`  · ${tie}\n`);
    }
  }

  if (problems.length === 0) {
    process.stdout.write(
      '[verify] OK: todos los valores coinciden con el sistema original\n',
    );
  } else {
    process.stdout.write(`[verify] ${problems.length} DIFERENCIAS REALES:\n`);
    for (const problem of problems.slice(0, 40)) {
      process.stdout.write(`  - ${problem}\n`);
    }
    process.exit(1);
  }
}

/**
 * Compara en dos pasadas, y la distincion importa:
 *
 *  1. VALORES, cruzando por jugador. Cualquier diferencia aca es un error real
 *     del motor de calculo.
 *
 *  2. ORDEN, posicion por posicion. Una diferencia aca solo es un error si los
 *     dos jugadores NO estan empatados en los tres criterios de desempate.
 *     Cuando si lo estan, el orden es arbitrario: el sistema viejo los dejaba
 *     como venian del objeto acumulador y el nuevo desempata por playerId, que
 *     al menos es estable entre consultas. Se informan aparte, sin fallar.
 */
function compare(label, expected, actual, legacyNameById, nameById, problems, ties) {
  if (expected.length !== actual.length) {
    problems.push(
      `${label}: filas esperadas ${expected.length}, obtenidas ${actual.length}`,
    );
  }

  const actualByName = new Map(actual.map((row) => [nameById.get(row.playerId), row]));

  for (const e of expected) {
    const expectedName = legacyNameById.get(e.pid);
    const a = actualByName.get(expectedName);

    if (!a) {
      problems.push(`${label}: falta ${expectedName} en la tabla nueva`);
      continue;
    }

    const checks = [
      ['played', e.played, a.played],
      ['won', e.won, a.won],
      ['drew', e.drew, a.drew],
      ['lost', e.lost, a.lost],
      ['dif', e.dif, a.goalsDiference],
      ['points', e.points, a.points],
      ['winRate', e.wr, a.winRate],
      ['netPoints', e.net, a.netPoints],
    ];

    for (const [field, expectedValue, actualValue] of checks) {
      if (!near(expectedValue, actualValue)) {
        problems.push(
          `${label} · ${expectedName} · ${field}: esperado ${expectedValue}, ` +
            `obtenido ${actualValue}`,
        );
      }
    }
  }

  const size = Math.min(expected.length, actual.length);
  for (let i = 0; i < size; i++) {
    const e = expected[i];
    const a = actual[i];
    const expectedName = legacyNameById.get(e.pid);
    const actualName = nameById.get(a.playerId);

    if (expectedName === actualName) continue;

    const tied =
      near(e.net, a.netPoints) && near(e.dif, a.goalsDiference) && near(e.wr, a.winRate);

    if (tied) {
      ties.push(`${label} pos ${i + 1}: ${expectedName} <-> ${actualName} (empate exacto)`);
    } else {
      problems.push(
        `${label} pos ${i + 1}: esperado ${expectedName}, obtenido ${actualName}`,
      );
    }
  }
}

main().catch((error) => {
  console.error(`[verify] ERROR: ${error.message}`);
  process.exit(1);
});
