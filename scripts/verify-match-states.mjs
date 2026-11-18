#!/usr/bin/env node
/**
 * Prueba de no filtracion: un partido en preparacion (P) o listo (R) no puede
 * cambiar NINGUN calculo.
 *
 * Todo pasa en una sola conexion y una sola transaccion que termina en ROLLBACK:
 * la conexion ve sus propias filas sin confirmar, asi que se puede comparar el
 * antes y el despues sin dejar rastro en la base.
 *
 *   1. Foto de cada vista de views.sql y de los SPs de calculo.
 *   2. Se insertan un partido P (sin equipos) y uno R (con equipos y randoms)
 *      en el torneo en juego, con jugadores que ya juegan ese torneo.
 *   3. Foto de nuevo. Cualquier diferencia es una filtracion.
 *
 * Uso: node scripts/verify-match-states.mjs   (MYSQL_PORT=3307 en desarrollo)
 */
import { createConnection } from 'mysql2/promise';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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

// Los mismos tipos que la app (fechas como Date, TINY(1) como boolean): el
// codigo del diario y del Powerade que se ejecuta mas abajo depende de eso.
const { typeCast } = await import(pathToFileURL(join(ROOT, 'dist', 'database', 'database.pool-factory.js')).href);

const rootPassword = process.env.MYSQL_ROOT_PASSWORD || undefined;
const db = await createConnection({
  host: process.env.MYSQL_HOST ?? 'localhost',
  port: Number(process.env.MYSQL_PORT ?? 3306),
  user: rootPassword ? 'root' : (process.env.MYSQL_USER ?? 'root'),
  password: rootPassword ?? process.env.MYSQL_PASSWORD ?? '',
  database: process.env.MYSQL_DATABASE,
  typeCast,
});

const views = readFileSync(join(ROOT, 'database', 'views.sql'), 'utf8')
  .matchAll(/CREATE OR REPLACE VIEW (\w+)/g);
// vMatchDetail queda afuera a proposito: es el listado de partidos y SI muestra
// los P y R (a admins, y los R como proximo partido). No calcula nada.
const viewNames = [...views].map((m) => m[1]).filter((v) => v !== 'vMatchDetail');

/** Resultado de un CALL: el primer result set, o todos si devuelve varios. */
async function call(sql, params) {
  const [rows] = await db.query(sql, params);
  return Array.isArray(rows[0]) ? rows.filter(Array.isArray) : rows;
}

async function snapshot(ctx) {
  const out = {};
  for (const view of viewNames) {
    const [cols] = await db.query(
      'SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
      [view],
    );
    const order = Array.from({ length: cols[0].n }, (_, i) => i + 1).join(',');
    const [rows] = await db.query(`SELECT * FROM ${view} ORDER BY ${order}`);
    out[view] = rows;
  }
  const t = ctx.tournamentId;
  out['GetTournamentScoreboard'] = await call('CALL GetTournamentScoreboard(?)', [t]);
  out['GetGeneralScoreboard'] = await call('CALL GetGeneralScoreboard()');
  out['GetTournamentStats'] = await call('CALL GetTournamentStats(?)', [t]);
  out['GetGeneralStats'] = await call('CALL GetGeneralStats(?)', [1]);
  out['GetMundialitoBoard'] = await call('CALL GetMundialitoBoard()');
  out['SearchTournaments'] = await call('CALL SearchTournaments(NULL, NULL)');
  out['GetTournamentById'] = await call('CALL GetTournamentById(?)', [t]);
  out['SearchPlayers'] = await call('CALL SearchPlayers(NULL, NULL, NULL)');
  for (const p of ctx.playerIds) {
    out[`GetPlayerStats(${p})`] = await call('CALL GetPlayerStats(?, 1, 1)', [p]);
    out[`GetPlayerMundialito(${p})`] = await call('CALL GetPlayerMundialito(?, 1)', [p]);
    out[`GetPlayerAchievements(${p})`] = await call('CALL GetPlayerAchievements(?)', [p]);
    out[`GetPlayerById(${p})`] = await call('CALL GetPlayerById(?)', [p]);
  }
  return out;
}

/**
 * El diario y el Powerade leen partidos con SQL propio en TypeScript. Para que
 * esta prueba los cubra se ejecuta el codigo compilado real (dist/, hace falta
 * `npm run build`) contra la MISMA conexion de la transaccion, con un
 * DatabaseService minimo que delega en ella.
 */
async function loadAppReaders() {
  const load = async (rel) => (await import(pathToFileURL(join(ROOT, 'dist', rel)).href));
  const { DossierBuilder } = await load('modules/newsletter/dossier.builder.js');
  const { PoweradeRepository } = await load('modules/powerade/powerade.repository.js');
  const { NewsletterRepository } = await load('modules/newsletter/newsletter.repository.js');
  const callRaw = async (sp, params = []) => {
    const [rows] = await db.query(`CALL ${sp}(${params.map(() => '?').join(', ')})`, params);
    return rows;
  };
  const fakeDb = {
    withConnection: (fn) => fn(db),
    callMulti: async (sp, params) => (await callRaw(sp, params)).slice(0, -1),
    callList: async (sp, params) => (await callRaw(sp, params))[0],
    callSimple: async (sp, params) => (await callRaw(sp, params))[0][0],
    callSimpleOrNull: async (sp, params) => (await callRaw(sp, params))[0][0] ?? null,
  };
  return {
    dossier: new DossierBuilder(fakeDb),
    powerade: new PoweradeRepository(fakeDb),
    newsletter: new NewsletterRepository(fakeDb),
  };
}

async function snapshotApp(app, t) {
  const out = {};
  const dossier = await app.dossier.build([], { tournamentId: t });
  for (const [key, value] of Object.entries(dossier)) out[`dossier.${key}`] = value;
  out['powerade.findParticipants'] = await app.powerade.findParticipants(t);
  out['powerade.findMaxMatchId'] = await app.powerade.findMaxMatchId(t);
  out['powerade.countMatches'] = await app.powerade.countMatches(t, 0);
  out['powerade.findTournamentTable'] = await app.powerade.findTournamentTable(t);
  out['newsletter.findMaxMatchId'] = await app.newsletter.findMaxMatchId();
  return out;
}

async function insertPending(ctx) {
  const { tournamentId: t, playerIds } = ctx;
  const insertMatch = async (state) => {
    const [res] = await db.query(
      `INSERT INTO Matches (tournamentId, winnerTeam, goalsDiference, place, playedAt, isDerby, state)
       VALUES (?, NULL, 0, 'VERIFY', NOW() + INTERVAL 1 DAY, FALSE, ?)`,
      [t, state],
    );
    return res.insertId;
  };
  const p = await insertMatch('P');
  for (const id of playerIds) {
    await db.query('INSERT INTO MatchPlayers (playerId, matchId, tournamentId, team) VALUES (?, ?, ?, NULL)', [id, p, t]);
  }
  await db.query("INSERT INTO MatchGuests (matchId, tournamentId, `name`, team) VALUES (?, ?, 'Hernán', NULL)", [p, t]);

  const r = await insertMatch('R');
  for (const [i, id] of playerIds.entries()) {
    await db.query('INSERT INTO MatchPlayers (playerId, matchId, tournamentId, team) VALUES (?, ?, ?, ?)', [
      id, r, t, i % 2 ? 'L' : 'D',
    ]);
  }
  await db.query("INSERT INTO MatchGuests (matchId, tournamentId, `name`, team) VALUES (?, ?, 'Hernán', 'D'), (?, ?, 'Primo Tomi', 'L')", [r, t, r, t]);
}

function diff(before, after) {
  return Object.keys(before).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
}

try {
  await db.beginTransaction();

  const [[tournament]] = await db.query(
    "SELECT tournamentId FROM Tournaments WHERE state = 'P' AND wasTracked = TRUE ORDER BY startedAt DESC LIMIT 1",
  );
  if (!tournament) throw new Error('No hay torneo en juego con detalle para probar');
  const [players] = await db.query(
    `SELECT DISTINCT mp.playerId FROM MatchPlayers mp
     INNER JOIN Players p ON p.playerId = mp.playerId AND p.state = 'A'
     WHERE mp.tournamentId = ? ORDER BY mp.playerId LIMIT 6`,
    [tournament.tournamentId],
  );
  if (players.length < 6) throw new Error('El torneo en juego no tiene 6 jugadores activos');
  const ctx = { tournamentId: tournament.tournamentId, playerIds: players.map((r) => r.playerId) };

  const app = await loadAppReaders();
  const before = { ...(await snapshot(ctx)), ...(await snapshotApp(app, ctx.tournamentId)) };
  // El dossier tiene que ser determinista para poder compararlo: se arma dos veces.
  const again = await snapshotApp(app, ctx.tournamentId);
  const unstable = diff(again, Object.fromEntries(Object.keys(again).map((k) => [k, before[k]])));
  for (const key of unstable) {
    delete before[key];
    console.log(`  (no determinista, se omite: ${key})`);
  }
  await insertPending(ctx);
  const after = { ...(await snapshot(ctx)), ...(await snapshotApp(app, ctx.tournamentId)) };
  const changed = diff(before, after);

  if (changed.length) {
    console.error(`FALLA: ${changed.length} objetos cambiaron con partidos P/R:`);
    for (const name of changed) console.error(`  - ${name}`);
    process.exitCode = 1;
  } else {
    console.log(`OK: ${Object.keys(before).length} objetos sin cambios`);
  }
} finally {
  await db.rollback();
  await db.end();
}
