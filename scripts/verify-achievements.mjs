#!/usr/bin/env node
/**
 * Contrasta la asistencia que calcula la base contra una implementacion
 * independiente de las reglas.
 *
 * Asistencia: desde el primer partido de cada jugador, todo partido de torneo
 * con detalle cuenta. Presente si figura en la convocatoria, ausente si no.
 * Las rachas son tramos consecutivos de cada tipo.
 *
 * Por eso este script NO traduce el SQL a JavaScript. Escribe las reglas de
 * cero, en la forma mas obvia posible —un for sobre los partidos—, y compara
 * contra la vista. Si las dos implementaciones coinciden es porque la regla
 * esta bien, no porque se copio el mismo error dos veces.
 *
 * Uso: node scripts/verify-achievements.mjs
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

/**
 * Asistencia: desde el primer partido de cada jugador, todo partido de torneo
 * con detalle cuenta. Presente si figura en la convocatoria, ausente si no.
 * Las rachas son tramos consecutivos de cada tipo.
 */
function expectedAttendance(matches, lineups) {
  const result = new Map();
  const playerIds = [...new Set([...lineups.values()].flatMap((set) => [...set]))];

  for (const playerId of playerIds) {
    const mine = matches.filter((m) => lineups.get(m.matchId)?.has(playerId));
    if (mine.length === 0) continue;
    const debutAt = mine[0].playedAt;

    let bestPresent = 0;
    let bestAbsent = 0;
    let runPresent = 0;
    let runAbsent = 0;

    for (const match of matches) {
      if (match.playedAt < debutAt) continue;
      if (lineups.get(match.matchId)?.has(playerId)) {
        runPresent += 1;
        runAbsent = 0;
      } else {
        runAbsent += 1;
        runPresent = 0;
      }
      bestPresent = Math.max(bestPresent, runPresent);
      bestAbsent = Math.max(bestAbsent, runAbsent);
    }

    result.set(playerId, { bestAttendanceStreak: bestPresent, bestAbsenceStreak: bestAbsent });
  }
  return result;
}

/**
 * Compara un mapa `playerId -> valores esperados` contra las filas que trae
 * una vista, en las dos direcciones: valores que no coinciden, jugadores que
 * la vista devuelve de mas (no estan en `expected`) y jugadores esperados que
 * la vista no devuelve. Un solo sentido no alcanza: si la vista alguna vez
 * dejara de filtrar algo y sumara o perdiera jugadores, comparar solo desde
 * `actual` no lo detectaria.
 *
 * Pensado para reusarse en las comprobaciones que se vayan agregando a este
 * mismo archivo (proximos logros, todos por jugador).
 */
function compareByPlayerId(expected, actual, fields, label) {
  const problems = [];

  if (actual.length !== expected.size) {
    problems.push(
      `${label}: cantidad de filas esperadas ${expected.size}, obtenidas ${actual.length}`,
    );
  }

  const seen = new Set();
  for (const row of actual) {
    seen.add(row.playerId);
    const want = expected.get(row.playerId);
    if (!want) {
      problems.push(`${label}: jugador ${row.playerId} aparece en la vista y no deberia`);
      continue;
    }
    for (const key of fields) {
      if (Number(row[key]) !== want[key]) {
        problems.push(
          `${label}: jugador ${row.playerId} ${key}: base ${row[key]}, esperado ${want[key]}`,
        );
      }
    }
  }

  for (const playerId of expected.keys()) {
    if (!seen.has(playerId)) {
      problems.push(`${label}: falta el jugador ${playerId}, la vista no lo devuelve`);
    }
  }

  return problems;
}

/**
 * La tabla de un torneo despues de cada fecha. Una fecha es cada partido del
 * torneo. La penalizacion se resta completa desde la primera: PlayerPenalties
 * no tiene fecha, y asi la ultima fecha coincide con la tabla oficial.
 *
 * El desempate es el oficial: puntos netos, diferencia de gol, winrate, id.
 */
function expectedMatchdayLeaders(tournament, matches, results, penalties) {
  const acc = new Map();  // playerId -> { points, maxPoints, diff }
  const leaders = [];

  for (const match of matches) {
    for (const row of results.filter((r) => r.matchId === match.matchId)) {
      const entry = acc.get(row.playerId) ?? { points: 0, maxPoints: 0, diff: 0 };
      entry.points += row.result === 'W' ? tournament.winningPoints
                    : row.result === 'D' ? tournament.drawingPoints
                    : tournament.lossingPoints;
      entry.maxPoints += tournament.winningPoints;
      entry.diff += row.goalsDiference;
      acc.set(row.playerId, entry);
    }

    const table = [...acc.entries()].map(([playerId, entry]) => ({
      playerId,
      netPoints: entry.points - (penalties.get(playerId) ?? 0),
      diff: entry.diff,
      winRate: entry.maxPoints > 0 ? entry.points / entry.maxPoints : 0,
    }));

    table.sort((a, b) =>
      b.netPoints - a.netPoints ||
      b.diff - a.diff ||
      b.winRate - a.winRate ||
      a.playerId - b.playerId);

    leaders.push(table[0].playerId);
  }
  return leaders;   // leaders[i] es el lider despues de la fecha i+1
}

/**
 * Compara el lider de cada fecha de cada torneo contra
 * vTournamentMatchdayStandings. La clave no es el playerId (como en
 * compareByPlayerId): es compuesta, torneo + fecha, asi que hace falta una
 * comparacion propia en vez de forzar el helper de arriba.
 *
 * Reporta cada diferencia con el torneo, la fecha, quien dice la base y quien
 * el calculo.
 */
function compareMatchdayLeaders(expectedByTournament, actualRows) {
  const problems = [];

  const actualByKey = new Map();
  for (const row of actualRows) {
    actualByKey.set(`${row.tournamentId}:${row.matchday}`, row.playerId);
  }

  for (const [tournamentId, leaders] of expectedByTournament) {
    for (let i = 0; i < leaders.length; i++) {
      const matchday = i + 1;
      const key = `${tournamentId}:${matchday}`;
      const expectedLeader = leaders[i];

      if (!actualByKey.has(key)) {
        problems.push(
          `torneo ${tournamentId} fecha ${matchday}: la base no tiene lider, esperado ${expectedLeader}`,
        );
        continue;
      }

      const actualLeader = Number(actualByKey.get(key));
      if (actualLeader !== expectedLeader) {
        problems.push(
          `torneo ${tournamentId} fecha ${matchday}: base dice ${actualLeader}, calculo dice ${expectedLeader}`,
        );
      }
    }
  }

  return problems;
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
    const [matches] = await connection.query(`
      SELECT m.matchId, m.playedAt
      FROM Matches m
      INNER JOIN Tournaments t ON t.tournamentId = m.tournamentId
      WHERE t.wasTracked = TRUE
      ORDER BY m.playedAt, m.matchId
    `);
    const [rows] = await connection.query('SELECT matchId, playerId FROM MatchPlayers');
    const lineups = new Map();
    for (const row of rows) {
      if (!lineups.has(row.matchId)) lineups.set(row.matchId, new Set());
      lineups.get(row.matchId).add(row.playerId);
    }

    const expected = expectedAttendance(matches, lineups);

    const [actual] = await connection.query('SELECT * FROM vPlayerAttendanceStreaks');
    const problems = compareByPlayerId(
      expected,
      actual,
      ['bestAttendanceStreak', 'bestAbsenceStreak'],
      'asistencia',
    );

    if (problems.length > 0) {
      console.error(`[verify] ${problems.length} DIFERENCIAS:`);
      for (const problem of problems.slice(0, 40)) console.error(`  - ${problem}`);
      if (problems.length > 40) console.error(`  ... y ${problems.length - 40} mas`);
      process.exitCode = 1;
    } else {
      console.log('asistencia OK');
    }

    // -------------------------------------------------------------------------
    // Posiciones fecha a fecha
    // -------------------------------------------------------------------------
    const [tournaments] = await connection.query(
      'SELECT tournamentId, winningPoints, drawingPoints, lossingPoints FROM Tournaments',
    );
    const [tourMatches] = await connection.query(
      'SELECT matchId, tournamentId, playedAt FROM Matches ORDER BY playedAt, matchId',
    );
    const [tourResults] = await connection.query(
      'SELECT playerId, matchId, result, goalsDiference FROM vMatchPlayerResults',
    );
    const [tourPenalties] = await connection.query(
      'SELECT playerId, tournamentId, penalty FROM PlayerPenalties',
    );

    const matchesByTournament = new Map();
    for (const match of tourMatches) {
      if (!matchesByTournament.has(match.tournamentId)) {
        matchesByTournament.set(match.tournamentId, []);
      }
      matchesByTournament.get(match.tournamentId).push(match);
    }

    const expectedByTournament = new Map();
    for (const tournament of tournaments) {
      const matches = matchesByTournament.get(tournament.tournamentId) ?? [];

      const penalties = new Map();
      for (const p of tourPenalties) {
        if (p.tournamentId === tournament.tournamentId) {
          penalties.set(p.playerId, Number(p.penalty));
        }
      }

      const leaders = expectedMatchdayLeaders(tournament, matches, tourResults, penalties);
      expectedByTournament.set(tournament.tournamentId, leaders);
    }

    const [actualLeaders] = await connection.query(
      'SELECT tournamentId, matchday, playerId FROM vTournamentMatchdayStandings WHERE `position` = 1',
    );

    const matchdayProblems = compareMatchdayLeaders(expectedByTournament, actualLeaders);

    if (matchdayProblems.length > 0) {
      console.error(`[verify] ${matchdayProblems.length} DIFERENCIAS en fecha a fecha:`);
      for (const problem of matchdayProblems.slice(0, 40)) console.error(`  - ${problem}`);
      if (matchdayProblems.length > 40) {
        console.error(`  ... y ${matchdayProblems.length - 40} mas`);
      }
      process.exitCode = 1;
    } else {
      console.log('fecha a fecha OK');
    }
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(`[verify] ERROR: ${error.message}`);
  process.exit(1);
});
