#!/usr/bin/env node
/**
 * Contrasta los descensos que calcula la base contra una implementacion
 * independiente de la regla.
 *
 * La regla, en palabras: se desciende al pasar 8 partidos sin ganar. Lo unico
 * que salva es ganar; el empate suma al contador igual que una derrota. Y el
 * contador no se reinicia al descender: dentro del mismo tramo, cada 8 partidos
 * es otro descenso.
 *
 * Igual que verify-achievements.mjs, esto NO traduce el SQL a JavaScript.
 * Escribe la regla de cero, en la forma mas obvia posible —un for sobre los
 * partidos de cada jugador con dos contadores— y compara contra las vistas. Si
 * las dos implementaciones coinciden es porque la regla esta bien, no porque se
 * copio el mismo error dos veces.
 *
 * Uso: node scripts/verify-relegations.mjs
 */
import { createConnection } from 'mysql2/promise';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const MATCHES_TO_RELEGATE = 8;

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

/**
 * Las carreras al descenso de UN jugador, recorriendo sus partidos en orden.
 *
 * Un contador y nada mas: partidos sin ganar seguidos. La victoria lo pone en
 * cero; el empate y la derrota lo suben igual. Al llegar a ocho la carrera se
 * cierra como descenso consumado y la siguiente arranca de cero, que es lo que
 * hace que 16 sin ganar sean dos descensos.
 */
function expectedRuns(matches) {
  const runs = [];
  let current = null;

  for (const match of matches) {
    if (match.result === 'W') {
      if (current) runs.push(current);
      current = null;
      continue;
    }

    if (!current) current = { matches: [], losses: 0 };
    current.matches.push(match);
    if (match.result === 'L') current.losses += 1;

    if (current.matches.length === MATCHES_TO_RELEGATE) {
      runs.push(current);
      current = null;
    }
  }

  // La ultima carrera queda abierta: el tramo sigue vivo porque no hubo mas
  // partidos.
  if (current) {
    current.isOpen = true;
    runs.push(current);
  }

  return runs.map((run, index) => ({
    runIndex: index + 1,
    matches: run.matches.length,
    losses: run.losses,
    draws: run.matches.length - run.losses,
    startedAt: run.matches[0].playedAt,
    endedAt:
      run.matches.length >= MATCHES_TO_RELEGATE
        ? run.matches[run.matches.length - 1].playedAt
        : null,
    isRelegated: run.matches.length >= MATCHES_TO_RELEGATE ? 1 : 0,
    isAllLosses:
      run.matches.length >= MATCHES_TO_RELEGATE && run.losses === run.matches.length ? 1 : 0,
    isOpen: run.isOpen ? 1 : 0,
    matchList: run.matches.map((match, i) => ({ ...match, posInRace: i + 1 })),
  }));
}

/** Compara las carreras esperadas contra vPlayerRelegationRuns, en las dos direcciones. */
function compareRuns(expectedByPlayer, actualRows) {
  const problems = [];
  const fields = ['matches', 'losses', 'draws', 'isRelegated', 'isAllLosses', 'isOpen'];

  const actualByPlayer = new Map();
  for (const row of actualRows) {
    if (!actualByPlayer.has(row.playerId)) actualByPlayer.set(row.playerId, []);
    actualByPlayer.get(row.playerId).push(row);
  }

  const playerIds = new Set([...expectedByPlayer.keys(), ...actualByPlayer.keys()]);

  for (const playerId of playerIds) {
    const want = expectedByPlayer.get(playerId) ?? [];
    const got = (actualByPlayer.get(playerId) ?? []).sort((a, b) => a.runIndex - b.runIndex);

    if (want.length !== got.length) {
      problems.push(
        `carreras: jugador ${playerId} tiene ${got.length} carreras, esperadas ${want.length}`,
      );
      continue;
    }

    for (let i = 0; i < want.length; i++) {
      for (const key of fields) {
        if (Number(got[i][key]) !== Number(want[i][key])) {
          problems.push(
            `carreras: jugador ${playerId} carrera ${want[i].runIndex} ${key}: ` +
            `base ${got[i][key]}, esperado ${want[i][key]}`,
          );
        }
      }
      // Las fechas son el otro contrato: startedAt es el primer partido de la
      // carrera y endedAt el octavo, o null si la carrera no se completo.
      if (!sameInstant(got[i].startedAt, want[i].startedAt)) {
        problems.push(
          `carreras: jugador ${playerId} carrera ${want[i].runIndex} startedAt: ` +
          `base ${iso(got[i].startedAt)}, esperado ${iso(want[i].startedAt)}`,
        );
      }
      if (!sameInstant(got[i].endedAt, want[i].endedAt)) {
        problems.push(
          `carreras: jugador ${playerId} carrera ${want[i].runIndex} endedAt: ` +
          `base ${iso(got[i].endedAt)}, esperado ${iso(want[i].endedAt)}`,
        );
      }
    }
  }

  return problems;
}

/**
 * Compara los partidos de cada carrera contra vPlayerWinlessRunMatches, unida a
 * las carreras igual que lo hace el SP. Es lo que dibuja el perfil, y tiene su
 * propia forma de fallar: es la unica comprobacion que mira el ORDEN de los
 * partidos dentro de la carrera, y un off-by-one en la casilla no mueve ningun
 * contador de los de arriba.
 */
function compareRunMatches(expectedByPlayer, actualRows) {
  const problems = [];

  const actualByKey = new Map();
  for (const row of actualRows) {
    const key = `${row.playerId}:${row.runIndex}`;
    if (!actualByKey.has(key)) actualByKey.set(key, []);
    actualByKey.get(key).push(row);
  }

  for (const [playerId, runs] of expectedByPlayer) {
    for (const run of runs) {
      const key = `${playerId}:${run.runIndex}`;
      const got = actualByKey.get(key) ?? [];
      actualByKey.delete(key);

      if (got.length !== run.matchList.length) {
        problems.push(
          `partidos: jugador ${playerId} carrera ${run.runIndex} tiene ${got.length} partidos, ` +
          `esperados ${run.matchList.length}`,
        );
        continue;
      }

      for (let i = 0; i < run.matchList.length; i++) {
        if (got[i].matchId !== run.matchList[i].matchId) {
          problems.push(
            `partidos: jugador ${playerId} carrera ${run.runIndex} posicion ${i}: ` +
            `base partido ${got[i].matchId}, esperado ${run.matchList[i].matchId}`,
          );
        }
        if (Number(got[i].posInRace) !== run.matchList[i].posInRace) {
          problems.push(
            `partidos: jugador ${playerId} carrera ${run.runIndex} partido ${got[i].matchId} ` +
            `posInRace: base ${got[i].posInRace}, esperado ${run.matchList[i].posInRace}`,
          );
        }
      }
    }
  }

  // Lo que sobro son carreras que la vista devuelve y nadie espera.
  for (const [key, rows] of actualByKey) {
    problems.push(`partidos: la vista devuelve ${rows.length} partidos para ${key}, que no existe`);
  }

  return problems;
}

/** Dos fechas (o dos nulls) son el mismo instante. */
function sameInstant(a, b) {
  if (a === null || a === undefined) return b === null || b === undefined;
  if (b === null || b === undefined) return false;
  return new Date(a).getTime() === new Date(b).getTime();
}

function iso(value) {
  return value === null || value === undefined ? 'null' : new Date(value).toISOString();
}

// -----------------------------------------------------------------------------
// Casos sinteticos
// -----------------------------------------------------------------------------
// Los datos reales apenas descienden a nadie —los tramos mas largos rozan los
// ocho— y eso deja el camino principal casi sin ejercitar: los dos descensos de
// un mismo tramo, el empate que suma, el descenso con las ocho perdidas.
// Comparar dos implementaciones que nunca pasan por ahi no prueba nada de eso.
//
// Cada caso es una secuencia de resultados escrita a mano, con lo que tiene que
// pasar. Se corren contra las vistas REALES, leidas de database/views.sql y
// creadas en una base aparte que se borra al terminar: el SQL que se prueba es
// el mismo que corre en produccion, no una copia que podria divergir.
//
// La base de verdad no se toca en ningun momento.
const SANDBOX_DB = 'murieron_relegation_cases';

const SANDBOX_VIEWS = [
  'vMatchPlayerResults',
  'vPlayerWinlessRunMatches',
  'vPlayerRelegationRuns',
  'vPlayerRelegations',
];

// L derrota, D empate, W victoria. Un caracter por partido, en orden.
const CASES = [
  { name: 'ocho derrotas al hilo son un descenso',
    seq: 'LLLLLLLL', relegations: 1, allLosses: 1, worst: 8,
    runs: [{ matches: 8, losses: 8, draws: 0, isRelegated: 1, isAllLosses: 1, isOpen: 0 }] },

  { name: 'ocho sin ganar con empates tambien descienden',
    seq: 'LLDLLDLL', relegations: 1, allLosses: 0, worst: 8,
    runs: [{ matches: 8, losses: 6, draws: 2, isRelegated: 1, isAllLosses: 0, isOpen: 0 }] },

  { name: 'ocho empates son un descenso igual',
    seq: 'DDDDDDDD', relegations: 1, allLosses: 0, worst: 8,
    runs: [{ matches: 8, losses: 0, draws: 8, isRelegated: 1, isAllLosses: 0, isOpen: 0 }] },

  { name: 'siete no alcanzan',
    seq: 'LLLLLLL', relegations: 0, allLosses: 0, worst: 7,
    runs: [{ matches: 7, losses: 7, draws: 0, isRelegated: 0, isAllLosses: 0, isOpen: 1 }] },

  { name: 'la victoria borra la cuenta',
    seq: 'LLLLLLLWL', relegations: 0, allLosses: 0, worst: 7,
    runs: [{ matches: 7, losses: 7, isRelegated: 0, isOpen: 0 },
           { matches: 1, losses: 1, isRelegated: 0, isOpen: 1 }] },

  { name: 'dieciseis sin ganar son dos descensos',
    seq: 'LLLLLLLLLLLLLLLL', relegations: 2, allLosses: 2, worst: 8,
    runs: [{ matches: 8, losses: 8, isRelegated: 1, isAllLosses: 1, isOpen: 0 },
           { matches: 8, losses: 8, isRelegated: 1, isAllLosses: 1, isOpen: 0 }] },

  { name: 'el segundo descenso con un empate no es de los ocho perdidos',
    seq: 'LLLLLLLLLLLDLLLL', relegations: 2, allLosses: 1, worst: 8,
    runs: [{ matches: 8, losses: 8, isRelegated: 1, isAllLosses: 1, isOpen: 0 },
           { matches: 8, losses: 7, draws: 1, isRelegated: 1, isAllLosses: 0, isOpen: 0 }] },

  { name: 'veinte sin ganar son dos descensos y una cuenta abierta',
    seq: 'LLLLLLLLLLLLLLLLLLLL', relegations: 2, allLosses: 2, worst: 8,
    runs: [{ matches: 8, losses: 8, isRelegated: 1, isOpen: 0 },
           { matches: 8, losses: 8, isRelegated: 1, isOpen: 0 },
           { matches: 4, losses: 4, isRelegated: 0, isOpen: 1 }] },

  { name: 'la victoria despues del descenso corta la carrera siguiente',
    seq: 'LLLLLLLLLLWLL', relegations: 1, allLosses: 1, worst: 8,
    runs: [{ matches: 8, losses: 8, isRelegated: 1, isOpen: 0 },
           { matches: 2, losses: 2, isRelegated: 0, isOpen: 0 },
           { matches: 2, losses: 2, isRelegated: 0, isOpen: 1 }] },

  { name: 'el que solo gana no tiene carreras',
    seq: 'WWWW', relegations: 0, allLosses: 0, worst: 0, runs: [] },

  { name: 'un solo empate ya es una carrera de uno',
    seq: 'D', relegations: 0, allLosses: 0, worst: 1,
    runs: [{ matches: 1, losses: 0, draws: 1, isRelegated: 0, isOpen: 1 }] },

  { name: 'dos descensos separados por una victoria',
    seq: 'LLLLLLLLWLLLLLLLL', relegations: 2, allLosses: 2, worst: 8,
    runs: [{ matches: 8, losses: 8, isRelegated: 1, isOpen: 0 },
           { matches: 8, losses: 8, isRelegated: 1, isOpen: 0 }] },
];

/**
 * Saca del archivo de vistas las definiciones que hacen falta, sin reescribir
 * ninguna. El separador es el mismo criterio que usa apply-sql.mjs: acumular
 * lineas hasta el `;`, ignorando los comentarios para que un `--` con punto y
 * coma adentro no corte de mas. En views.sql no hay DELIMITER, son todas vistas.
 */
function extractViews(sql, names) {
  const statements = [];
  let buffer = '';
  for (const rawLine of sql.split('\n')) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();
    if (trimmed.startsWith('--') || trimmed === '') {
      if (buffer !== '') buffer += '\n' + line;
      continue;
    }
    buffer += (buffer ? '\n' : '') + line;
    if (buffer.trimEnd().endsWith(';')) {
      statements.push(buffer.trimEnd().slice(0, -1).trim());
      buffer = '';
    }
  }

  const wanted = new Map();
  for (const statement of statements) {
    const match = statement.match(/CREATE\s+OR\s+REPLACE\s+VIEW\s+(\w+)\s+AS/i);
    if (match && names.includes(match[1])) wanted.set(match[1], statement);
  }

  const missing = names.filter((name) => !wanted.has(name));
  if (missing.length > 0) {
    throw new Error(`no se encontraron en views.sql: ${missing.join(', ')}`);
  }

  // En el orden pedido, que es el de dependencia.
  return names.map((name) => wanted.get(name));
}

/**
 * Arma la base de prueba: las tres tablas que la cadena de vistas necesita
 * —solo con las columnas que se leen— y las vistas de verdad encima.
 */
async function setUpSandbox(connection) {
  await connection.query(`DROP DATABASE IF EXISTS \`${SANDBOX_DB}\``);
  await connection.query(`CREATE DATABASE \`${SANDBOX_DB}\``);
  await connection.query(`USE \`${SANDBOX_DB}\``);

  await connection.query(`
    CREATE TABLE Players (
      playerId INT PRIMARY KEY,
      displayName VARCHAR(120) NOT NULL
    )`);
  await connection.query(`
    CREATE TABLE Matches (
      matchId INT PRIMARY KEY,
      tournamentId INT NOT NULL,
      playedAt DATETIME NOT NULL,
      winnerTeam CHAR(1) NULL,
      goalsDiference INT NOT NULL DEFAULT 0,
      isDerby TINYINT(1) NOT NULL DEFAULT 0,
      place VARCHAR(40) NULL
    )`);
  await connection.query(`
    CREATE TABLE MatchPlayers (
      matchId INT NOT NULL,
      playerId INT NOT NULL,
      tournamentId INT NOT NULL,
      team CHAR(1) NOT NULL,
      PRIMARY KEY (matchId, playerId)
    )`);

  const views = extractViews(readFileSync(join(ROOT, 'database', 'views.sql'), 'utf8'), SANDBOX_VIEWS);
  for (const view of views) await connection.query(view);
}

/**
 * Corre los casos uno por uno, cada uno en su propio juego de partidos, y
 * compara contra las vistas.
 *
 * Cada caso se carga y se borra por separado en vez de todos juntos: el
 * resultado de un partido es del PARTIDO (quien gano), no del jugador, asi que
 * dos secuencias distintas no pueden compartir la misma fila de Matches.
 */
async function runCases(connection) {
  const problems = [];

  for (let c = 0; c < CASES.length; c++) {
    const testCase = CASES[c];
    const playerId = 1;

    await connection.query('DELETE FROM MatchPlayers');
    await connection.query('DELETE FROM Matches');
    await connection.query('DELETE FROM Players');
    await connection.query('INSERT INTO Players VALUES (?, ?)', [playerId, testCase.name]);

    for (let i = 0; i < testCase.seq.length; i++) {
      const result = testCase.seq[i];
      // El jugador siempre en el equipo A: gana si winnerTeam es 'A', pierde si
      // es 'B', empata si es NULL.
      const winner = result === 'W' ? 'A' : result === 'L' ? 'B' : null;
      await connection.query(
        'INSERT INTO Matches (matchId, tournamentId, playedAt, winnerTeam, goalsDiference) VALUES (?, 1, ?, ?, 1)',
        [i + 1, new Date(Date.UTC(2020, 0, 1 + i)), winner],
      );
      await connection.query(
        'INSERT INTO MatchPlayers (matchId, playerId, tournamentId, team) VALUES (?, ?, 1, ?)',
        [i + 1, playerId, 'A'],
      );
    }

    const [runs] = await connection.query(
      'SELECT * FROM vPlayerRelegationRuns ORDER BY runIndex',
    );
    const [[summary]] = await connection.query('SELECT * FROM vPlayerRelegations');

    const label = `caso "${testCase.name}" (${testCase.seq})`;

    if (Number(summary.relegations) !== testCase.relegations) {
      problems.push(
        `${label}: descensos base ${summary.relegations}, esperados ${testCase.relegations}`,
      );
    }
    if (Number(summary.allLossRelegations) !== testCase.allLosses) {
      problems.push(
        `${label}: descensos con los ocho perdidos base ${summary.allLossRelegations}, ` +
        `esperados ${testCase.allLosses}`,
      );
    }
    if (Number(summary.worstRaceMatches) !== testCase.worst) {
      problems.push(
        `${label}: worstRaceMatches base ${summary.worstRaceMatches}, esperado ${testCase.worst}`,
      );
    }
    if (runs.length !== testCase.runs.length) {
      problems.push(
        `${label}: ${runs.length} carreras, esperadas ${testCase.runs.length}`,
      );
      continue;
    }
    for (let i = 0; i < testCase.runs.length; i++) {
      for (const [key, value] of Object.entries(testCase.runs[i])) {
        if (Number(runs[i][key]) !== value) {
          problems.push(
            `${label}: carrera ${i + 1} ${key}: base ${runs[i][key]}, esperado ${value}`,
          );
        }
      }
    }

    // La regla escrita en JavaScript tiene que decir lo mismo que las vistas
    // tambien en estos casos: es la misma comparacion de arriba, pero sobre
    // secuencias que los datos reales no tienen.
    const [rows] = await connection.query(
      'SELECT playerId, matchId, playedAt, result FROM vMatchPlayerResults ORDER BY playedAt, matchId',
    );
    const expected = new Map();
    const runsFromJs = expectedRuns(rows);
    if (runsFromJs.length > 0) expected.set(playerId, runsFromJs);
    problems.push(...compareRuns(expected, runs.map((run) => ({ ...run, playerId })))
      .map((problem) => `${label}: ${problem}`));
  }

  return problems;
}

function report(problems, okMessage) {
  if (problems.length > 0) {
    console.error(`[verify] ${problems.length} DIFERENCIAS:`);
    for (const problem of problems.slice(0, 40)) console.error(`  - ${problem}`);
    if (problems.length > 40) console.error(`  ... y ${problems.length - 40} mas`);
    process.exitCode = 1;
    return;
  }
  console.log(okMessage);
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
    // Los partidos de cada jugador en el mismo orden que usan las vistas. Los
    // torneos sin detalle entran: las rachas tambien los cuentan, y el descenso
    // acompania a la tabla historica, que los cuenta.
    const [results] = await connection.query(`
      SELECT playerId, matchId, playedAt, result
      FROM vMatchPlayerResults
      ORDER BY playerId, playedAt, matchId
    `);

    const byPlayer = new Map();
    for (const row of results) {
      if (!byPlayer.has(row.playerId)) byPlayer.set(row.playerId, []);
      byPlayer.get(row.playerId).push(row);
    }

    const expected = new Map();
    for (const [playerId, matches] of byPlayer) {
      const runs = expectedRuns(matches);
      if (runs.length > 0) expected.set(playerId, runs);
    }

    // -------------------------------------------------------------------------
    // Las carreras
    // -------------------------------------------------------------------------
    const [actualRuns] = await connection.query(
      'SELECT * FROM vPlayerRelegationRuns ORDER BY playerId, runIndex',
    );
    report(
      compareRuns(expected, actualRuns),
      `carreras al descenso OK (${actualRuns.length} carreras, ` +
      `${expected.size} jugadores con al menos una)`,
    );

    // -------------------------------------------------------------------------
    // Los partidos de cada carrera
    // -------------------------------------------------------------------------
    const [actualMatches] = await connection.query(`
      SELECT r.playerId, r.runIndex, m.matchId, m.playedAt, m.result, m.posInRace
      FROM vPlayerWinlessRunMatches m
      INNER JOIN vPlayerRelegationRuns r
        ON r.playerId = m.playerId AND r.runId = m.runId AND r.raceNo = m.raceNo
      ORDER BY r.playerId, r.runIndex, m.playedAt, m.matchId
    `);
    report(
      compareRunMatches(expected, actualMatches),
      `partidos de cada carrera OK (${actualMatches.length} partidos)`,
    );

    // -------------------------------------------------------------------------
    // El resumen por jugador
    // -------------------------------------------------------------------------
    // vPlayerRelegations agrega lo de arriba, asi que lo que se comprueba aca
    // es la AGREGACION: que el contador sea la suma de las carreras completas y
    // no de todas, y que worstRaceMatches sea el maximo. Estan TODOS los
    // jugadores, incluido el que nunca jugo: los logros necesitan su fila en cero.
    const [allPlayers] = await connection.query('SELECT playerId FROM Players');
    const expectedSummary = new Map();
    for (const { playerId } of allPlayers) {
      const runs = expected.get(playerId) ?? [];
      expectedSummary.set(playerId, {
        relegations: runs.filter((run) => run.isRelegated === 1).length,
        allLossRelegations: runs.filter((run) => run.isAllLosses === 1).length,
        worstRaceMatches: runs.reduce((max, run) => Math.max(max, run.matches), 0),
      });
    }

    const [actualSummary] = await connection.query('SELECT * FROM vPlayerRelegations');
    const summaryProblems = [];
    if (actualSummary.length !== expectedSummary.size) {
      summaryProblems.push(
        `resumen: filas esperadas ${expectedSummary.size}, obtenidas ${actualSummary.length}`,
      );
    }
    for (const row of actualSummary) {
      const want = expectedSummary.get(row.playerId);
      if (!want) {
        summaryProblems.push(`resumen: jugador ${row.playerId} aparece y no deberia`);
        continue;
      }
      for (const key of ['relegations', 'allLossRelegations', 'worstRaceMatches']) {
        if (Number(row[key]) !== want[key]) {
          summaryProblems.push(
            `resumen: jugador ${row.playerId} ${key}: base ${row[key]}, esperado ${want[key]}`,
          );
        }
      }
    }
    report(
      summaryProblems,
      `resumen por jugador OK (${actualSummary.length} jugadores, ` +
      `${[...expectedSummary.values()].reduce((n, s) => n + s.relegations, 0)} descensos en total)`,
    );

    // -------------------------------------------------------------------------
    // Casos sinteticos
    // -------------------------------------------------------------------------
    try {
      await setUpSandbox(connection);
      report(await runCases(connection), `${CASES.length} casos sinteticos OK`);
    } finally {
      // Volver a la base de verdad antes de soltar la de prueba, y soltarla
      // pase lo que pase: si un caso explota, la base temporal no queda dando
      // vueltas en el servidor de nadie.
      await connection.query(
        `USE \`${process.env.MYSQL_DATABASE ?? 'murieron_en_madrid'}\``,
      );
      await connection.query(`DROP DATABASE IF EXISTS \`${SANDBOX_DB}\``);
    }
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(`[verify] ERROR: ${error.message}`);
  process.exit(1);
});
