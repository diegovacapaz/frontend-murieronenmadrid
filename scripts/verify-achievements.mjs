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
 * La tabla COMPLETA de un torneo despues de cada fecha —todo el plantel, no
 * solo el lider—. Una fecha es cada partido del torneo. El plantel arranca
 * en cero desde antes de la primera fecha: el que todavia no debuto aparece
 * igual, con cero puntos, cero diferencia y sin winrate (null, como hace la
 * vista cuando maxPoints es 0).
 *
 * La penalizacion se resta completa desde la primera: PlayerPenalties no
 * tiene fecha, y asi la ultima fecha coincide con la tabla oficial.
 *
 * El desempate es el oficial: puntos netos, diferencia de gol, winrate, id.
 * MySQL trata NULL como el valor mas chico en un ORDER BY ... DESC, asi que
 * el que no jugo nada todavia (winRate null) siempre pierde ese desempate.
 */
function expectedMatchdayStandings(tournament, matches, results, penalties, roster) {
  const acc = new Map();  // playerId -> { points, maxPoints, diff }
  for (const playerId of roster) {
    acc.set(playerId, { points: 0, maxPoints: 0, diff: 0 });
  }

  const tables = [];

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
      points: entry.points,
      netPoints: entry.points - (penalties.get(playerId) ?? 0),
      goalsDiference: entry.diff,
      winRate: entry.maxPoints > 0 ? entry.points / entry.maxPoints : null,
    }));

    table.sort((a, b) =>
      b.netPoints - a.netPoints ||
      b.goalsDiference - a.goalsDiference ||
      compareWinRateDesc(a.winRate, b.winRate) ||
      a.playerId - b.playerId);

    table.forEach((row, index) => { row.position = index + 1; });

    tables.push(table);
  }
  return tables;   // tables[i] es la tabla completa despues de la fecha i+1
}

/**
 * DESC tratando null como el valor mas chico, igual que MySQL en un
 * `ORDER BY ... DESC`: el que no jugo nada (sin winrate) va siempre al final
 * de este desempate.
 */
function compareWinRateDesc(a, b) {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return b - a;
}

/**
 * Pico y piso de la diferencia de gol acumulada a lo largo de la carrera. Es lo
 * que vuelve historicos a Pichichi y Pichi: importa haber tocado +50 alguna vez,
 * no estar en +50 hoy. Aca cuentan todos los partidos, igual que en la tabla
 * historica que el jugador ve en su perfil.
 */
function expectedPeaks(playerMatches) {
  let running = 0;
  let peak = 0;
  let floor = 0;
  for (const match of playerMatches) {
    running += match.goalsDiference;
    peak = Math.max(peak, running);
    floor = Math.min(floor, running);
  }
  return { peakGoalDiff: peak, floorGoalDiff: floor };
}

/** La racha mas larga de derrotas consecutivas. */
function expectedWorstLoss(playerMatches) {
  let best = 0;
  let run = 0;
  for (const match of playerMatches) {
    run = match.result === 'L' ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}

/**
 * Compara la tabla COMPLETA (todas las filas, todas las columnas derivadas)
 * contra vTournamentMatchdayStandings, torneo por torneo y fecha por fecha.
 * No alcanza con mirar el lider: la mayoria de las filas de esa vista son
 * puestos 2..N, y si nadie las mira un bug ahi no se entera nadie.
 *
 * La clave no es el playerId (como en compareByPlayerId): es compuesta,
 * torneo + fecha + jugador, asi que hace falta una comparacion propia en vez
 * de forzar el helper de arriba.
 *
 * En las dos direcciones: valores que no coinciden, filas que la vista
 * devuelve de mas y filas esperadas que la vista no tiene.
 */
function compareMatchdayStandings(expectedByTournament, actualRows) {
  const problems = [];
  const EPS = 1e-9;

  const expectedByKey = new Map();
  for (const [tournamentId, tables] of expectedByTournament) {
    for (let i = 0; i < tables.length; i++) {
      const matchday = i + 1;
      for (const row of tables[i]) {
        expectedByKey.set(`${tournamentId}:${matchday}:${row.playerId}`, row);
      }
    }
  }

  const seen = new Set();
  for (const row of actualRows) {
    const key = `${row.tournamentId}:${row.matchday}:${row.playerId}`;
    seen.add(key);
    const want = expectedByKey.get(key);

    if (!want) {
      problems.push(
        `torneo ${row.tournamentId} fecha ${row.matchday}: jugador ${row.playerId} aparece en la vista y no deberia`,
      );
      continue;
    }

    if (Math.abs(Number(row.points) - want.points) > EPS) {
      problems.push(
        `torneo ${row.tournamentId} fecha ${row.matchday} jugador ${row.playerId}: ` +
        `points base ${row.points}, esperado ${want.points}`,
      );
    }
    if (Number(row.goalsDiference) !== want.goalsDiference) {
      problems.push(
        `torneo ${row.tournamentId} fecha ${row.matchday} jugador ${row.playerId}: ` +
        `goalsDiference base ${row.goalsDiference}, esperado ${want.goalsDiference}`,
      );
    }
    if (Math.abs(Number(row.netPoints) - want.netPoints) > EPS) {
      problems.push(
        `torneo ${row.tournamentId} fecha ${row.matchday} jugador ${row.playerId}: ` +
        `netPoints base ${row.netPoints}, esperado ${want.netPoints}`,
      );
    }

    const actualWinRate = row.winRate === null ? null : Number(row.winRate);
    const winRateMismatch = actualWinRate === null || want.winRate === null
      ? actualWinRate !== want.winRate
      : Math.abs(actualWinRate - want.winRate) > EPS;
    if (winRateMismatch) {
      problems.push(
        `torneo ${row.tournamentId} fecha ${row.matchday} jugador ${row.playerId}: ` +
        `winRate base ${row.winRate}, esperado ${want.winRate}`,
      );
    }

    if (Number(row.position) !== want.position) {
      problems.push(
        `torneo ${row.tournamentId} fecha ${row.matchday} jugador ${row.playerId}: ` +
        `position base ${row.position}, esperado ${want.position}`,
      );
    }
  }

  for (const [key, want] of expectedByKey) {
    if (!seen.has(key)) {
      problems.push(`falta la fila ${key}, la vista no la devuelve (esperado position ${want.position})`);
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
    // El plantel de cada torneo: los mismos jugadores que cruza la vista antes
    // del LEFT JOIN contra los resultados, para que el que no debuto todavia
    // aparezca igual en la tabla, en cero.
    const [tourRoster] = await connection.query(
      'SELECT DISTINCT tournamentId, playerId FROM MatchPlayers',
    );

    const matchesByTournament = new Map();
    for (const match of tourMatches) {
      if (!matchesByTournament.has(match.tournamentId)) {
        matchesByTournament.set(match.tournamentId, []);
      }
      matchesByTournament.get(match.tournamentId).push(match);
    }

    const rosterByTournament = new Map();
    for (const row of tourRoster) {
      if (!rosterByTournament.has(row.tournamentId)) {
        rosterByTournament.set(row.tournamentId, []);
      }
      rosterByTournament.get(row.tournamentId).push(row.playerId);
    }

    const expectedByTournament = new Map();
    for (const tournament of tournaments) {
      const matches = matchesByTournament.get(tournament.tournamentId) ?? [];
      const roster = rosterByTournament.get(tournament.tournamentId) ?? [];

      const penalties = new Map();
      for (const p of tourPenalties) {
        if (p.tournamentId === tournament.tournamentId) {
          penalties.set(p.playerId, Number(p.penalty));
        }
      }

      const tables = expectedMatchdayStandings(tournament, matches, tourResults, penalties, roster);
      expectedByTournament.set(tournament.tournamentId, tables);
    }

    const [actualStandings] = await connection.query(
      'SELECT tournamentId, matchday, playerId, points, goalsDiference, netPoints, winRate, `position` ' +
      'FROM vTournamentMatchdayStandings',
    );

    const matchdayProblems = compareMatchdayStandings(expectedByTournament, actualStandings);

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

    // -------------------------------------------------------------------------
    // Picos de diferencia de gol acumulada, y racha de derrotas
    // -------------------------------------------------------------------------
    const [streakMatches] = await connection.query(`
      SELECT playerId, matchId, result, goalsDiference, playedAt
      FROM vMatchPlayerResults
      ORDER BY playerId, playedAt, matchId
    `);

    const matchesByPlayer = new Map();
    for (const match of streakMatches) {
      if (!matchesByPlayer.has(match.playerId)) matchesByPlayer.set(match.playerId, []);
      matchesByPlayer.get(match.playerId).push(match);
    }

    const expectedPeaksByPlayer = new Map();
    const expectedWorstLossByPlayer = new Map();
    for (const [playerId, matches] of matchesByPlayer) {
      expectedPeaksByPlayer.set(playerId, expectedPeaks(matches));
      expectedWorstLossByPlayer.set(playerId, { worstLoss: expectedWorstLoss(matches) });
    }

    const [actualPeaks] = await connection.query(
      'SELECT playerId, peakGoalDiff, floorGoalDiff FROM vPlayerGoalDiffPeaks',
    );
    const peakProblems = compareByPlayerId(
      expectedPeaksByPlayer,
      actualPeaks,
      ['peakGoalDiff', 'floorGoalDiff'],
      'picos de diferencia de gol',
    );

    const [actualWorstLoss] = await connection.query('SELECT playerId, worstLoss FROM vPlayerStreaks');
    const worstLossProblems = compareByPlayerId(
      expectedWorstLossByPlayer,
      actualWorstLoss,
      ['worstLoss'],
      'racha de derrotas',
    );

    const streakProblems = [...peakProblems, ...worstLossProblems];

    if (streakProblems.length > 0) {
      console.error(`[verify] ${streakProblems.length} DIFERENCIAS en picos/racha de derrotas:`);
      for (const problem of streakProblems.slice(0, 40)) console.error(`  - ${problem}`);
      if (streakProblems.length > 40) console.error(`  ... y ${streakProblems.length - 40} mas`);
      process.exitCode = 1;
    } else {
      console.log('picos de diferencia de gol y racha de derrotas OK');
    }
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(`[verify] ERROR: ${error.message}`);
  process.exit(1);
});
