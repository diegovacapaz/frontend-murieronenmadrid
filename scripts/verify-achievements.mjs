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
    let failures = 0;
    for (const row of actual) {
      const want = expected.get(row.playerId);
      if (!want) continue;
      for (const key of ['bestAttendanceStreak', 'bestAbsenceStreak']) {
        if (Number(row[key]) !== want[key]) {
          console.error(`jugador ${row.playerId} ${key}: base ${row[key]}, esperado ${want[key]}`);
          failures += 1;
        }
      }
    }
    console.log(failures === 0 ? 'asistencia OK' : `asistencia: ${failures} diferencias`);
    process.exitCode = failures === 0 ? 0 : 1;
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(`[verify] ERROR: ${error.message}`);
  process.exit(1);
});
