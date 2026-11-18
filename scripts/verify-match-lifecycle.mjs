#!/usr/bin/env node
/**
 * Recorre el ciclo de vida de un partido contra los SPs reales:
 * en preparacion (P) -> listo (R) -> jugado (J), y los rechazos de cada paso.
 *
 * Los SPs abren y cierran sus propias transacciones, asi que no se puede
 * envolver todo en un ROLLBACK. El script trabaja sobre un torneo de prueba
 * propio y lo borra entero al terminar, falle o no.
 *
 * Uso: node scripts/verify-match-lifecycle.mjs   (MYSQL_PORT=3307 en desarrollo)
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

const rootPassword = process.env.MYSQL_ROOT_PASSWORD || undefined;
const db = await createConnection({
  host: process.env.MYSQL_HOST ?? 'localhost',
  port: Number(process.env.MYSQL_PORT ?? 3306),
  user: rootPassword ? 'root' : (process.env.MYSQL_USER ?? 'root'),
  password: rootPassword ?? process.env.MYSQL_PASSWORD ?? '',
  database: process.env.MYSQL_DATABASE,
  dateStrings: true,
});

let failures = 0;
const ok = (label) => console.log(`  ok   ${label}`);
const fail = (label, detail) => {
  failures++;
  console.error(`  FAIL ${label}: ${detail}`);
};

/** Primer result set de un CALL. */
async function call(sql, params = []) {
  const [rows] = await db.query(sql, params);
  return Array.isArray(rows[0]) ? rows[0] : rows;
}

async function expectRow(label, sql, params, check) {
  try {
    const rows = await call(sql, params);
    const why = check(rows);
    if (why) fail(label, why);
    else ok(label);
    return rows;
  } catch (e) {
    fail(label, `error ${e.errno} ${e.message}`);
    return [];
  }
}

async function expectErrno(label, errno, sql, params) {
  try {
    await call(sql, params);
    fail(label, `se esperaba ${errno} y no fallo`);
  } catch (e) {
    if (e.errno === errno) ok(label);
    else fail(label, `se esperaba ${errno}, llego ${e.errno} ${e.message}`);
  }
}

const json = (v) => JSON.stringify(v);
const parse = (v) => (typeof v === 'string' ? JSON.parse(v) : v);

let tournamentId = null;
try {
  const [res] = await db.query(
    `INSERT INTO Tournaments (\`name\`, startedAt, endedAt, state, wasTracked, winningPoints, lossingPoints, drawingPoints)
     VALUES ('VERIFY-LIFECYCLE', NOW(), NOW() + INTERVAL 30 DAY, 'P', TRUE, 3, 0, 1)`,
  );
  tournamentId = res.insertId;
  const t = tournamentId;

  const [active] = await db.query(
    "SELECT playerId FROM Players WHERE state = 'A' ORDER BY isSagrado DESC, playerId LIMIT 8",
  );
  const [sagrado] = await db.query(
    "SELECT playerId FROM Players WHERE state = 'A' AND isSagrado = TRUE LIMIT 1",
  );
  if (active.length < 8) throw new Error('Hacen falta 8 jugadores activos');
  const ids = active.map((r) => r.playerId);

  // ── 1. crear en preparacion con total impar ─────────────────────────────────
  const five = ids.slice(0, 5).map((playerId) => ({ playerId, team: null }));
  const [created] = await expectRow(
    'crear P impar (5)',
    'CALL CreateMatch(?, NULL, 0, ?, NOW(), FALSE, ?, NULL, ?, ?)',
    [t, 'VERIFY', json(five), 'P', '[]'],
    (rows) => (rows[0]?.state === 'P' ? null : `state=${rows[0]?.state}`),
  );
  const m1 = created?.matchId;

  await expectErrno('crear con estado R', 46307, 'CALL CreateMatch(?, NULL, 0, ?, NOW(), FALSE, ?, NULL, ?, ?)', [
    t, 'VERIFY', json(five), 'R', '[]',
  ]);

  // ── 2. armar con impar ──────────────────────────────────────────────────────
  const teamsOf = (list) => list.map((p, i) => ({ playerId: p.playerId, team: i % 2 ? 'L' : 'D' }));
  await expectErrno('SetMatchTeams impar', 46308, 'CALL SetMatchTeams(?, ?, ?)', [m1, json(teamsOf(five)), '[]']);

  // ── 3. editar en P agregando un random -> 6 ─────────────────────────────────
  const [edited] = await expectRow(
    'editar P con un random',
    'CALL UpdateMatch(?, NULL, 0, ?, NOW(), FALSE, ?, NULL, ?, ?)',
    [m1, 'VERIFY', json(five), 'P', json([{ name: 'Hernán', team: null }])],
    (rows) => (parse(rows[0]?.guests)?.length === 1 ? null : `guests=${rows[0]?.guests}`),
  );
  const guestId = parse(edited?.guests ?? '[]')[0]?.guestId;

  // ── 4. armar par -> R ───────────────────────────────────────────────────────
  const players = ids.slice(0, 5).map((playerId, i) => ({ playerId, team: i < 3 ? 'D' : 'L' }));
  await expectRow(
    'SetMatchTeams 3 vs 3 -> R',
    'CALL SetMatchTeams(?, ?, ?)',
    [m1, json(players), json([{ guestId, team: 'L' }])],
    (rows) => (rows[0]?.state === 'R' ? null : `state=${rows[0]?.state}`),
  );

  await expectRow('GetUpcomingMatches lo incluye', 'CALL GetUpcomingMatches()', [], (rows) =>
    rows.some((r) => r.matchId === m1) ? null : 'no aparece',
  );

  // ── 5. deshacer y rehacer ──────────────────────────────────────────────────
  await expectRow('ClearMatchTeams R -> P', 'CALL ClearMatchTeams(?)', [m1], (rows) =>
    rows[0]?.state === 'P' && parse(rows[0].players).every((p) => p.team === null) ? null : `state=${rows[0]?.state}`,
  );
  await call('CALL SetMatchTeams(?, ?, ?)', [m1, json(players), json([{ guestId, team: 'L' }])]);

  // ── 6. finalizar -> J y suma ───────────────────────────────────────────────
  await expectRow(
    'FinishMatch -> J',
    'CALL FinishMatch(?, ?, ?, ?)',
    [m1, 'D', 2, 'Relato de prueba'],
    (rows) => (rows[0]?.state === 'J' && rows[0]?.winnerTeam === 'D' ? null : `state=${rows[0]?.state}`),
  );
  await expectRow(
    'el jugado aparece en vTournamentStandings',
    'SELECT COUNT(*) AS n FROM vTournamentStandings WHERE tournamentId = ?',
    [t],
    (rows) => (rows[0].n === 5 ? null : `n=${rows[0].n}`),
  );
  await expectErrno('ClearMatchTeams sobre J', 46307, 'CALL ClearMatchTeams(?)', [m1]);
  await expectErrno('FinishMatch sobre J', 46307, 'CALL FinishMatch(?, ?, ?, ?)', [m1, 'D', 1, null]);

  // ── 7. edit with active maker ──────────────────────────────────────────────
  const six = ids.slice(0, 6).map((playerId) => ({ playerId, team: null }));
  const [m2row] = await call('CALL CreateMatch(?, NULL, 0, ?, NOW(), FALSE, ?, NULL, ?, ?)', [
    t, 'VERIFY', json(six), 'P', '[]',
  ]);
  const m2 = m2row.matchId;
  await db.query("INSERT INTO TeamMakers (matchId, captainCode) VALUES (?, 'verifyverifyverifyveri')", [m2]);
  await expectErrno('UpdateMatch con maker activo', 46309, 'CALL UpdateMatch(?, NULL, 0, ?, NOW(), FALSE, ?, NULL, ?, ?)', [
    m2, 'VERIFY', json(six), 'P', '[]',
  ]);
  await expectErrno('SetMatchTeams con maker activo', 46309, 'CALL SetMatchTeams(?, ?, ?)', [
    m2, json(six.map((p, i) => ({ ...p, team: i % 2 ? 'L' : 'D' }))), '[]',
  ]);
  await expectRow('GetUpcomingMatches incluye P con maker activo', 'CALL GetUpcomingMatches()', [], (rows) =>
    rows.some((r) => r.matchId === m2) ? null : 'no aparece',
  );

  // ── 8. listado publico vs admin ────────────────────────────────────────────
  await expectRow('SearchMatches sin pendientes no muestra P', 'CALL SearchMatches(?, NULL, NULL, FALSE)', [t], (rows) =>
    rows.some((r) => r.matchId === m2) ? 'aparece el P' : null,
  );
  await expectRow('SearchMatches con pendientes muestra P', 'CALL SearchMatches(?, NULL, NULL, TRUE)', [t], (rows) =>
    rows.some((r) => r.matchId === m2) ? null : 'no aparece el P',
  );

  // ── 9. cerrar torneo con pendientes ────────────────────────────────────────
  await expectErrno('cerrar torneo con un P', 46207, 'CALL SetTournamentState(?, ?)', [t, 'F']);

  // ── 10. random repetido ───────────────────────────────────────────────────
  await expectErrno('random repetido', 46310, 'CALL CreateMatch(?, NULL, 0, ?, NOW(), FALSE, ?, NULL, ?, ?)', [
    t, 'VERIFY', json(six), 'P', json([{ name: 'Primo', team: null }, { name: 'Primo', team: null }]),
  ]);

  // ── 11. clasico: isSagrado no restringe ────────────────────────────────────
  if (sagrado.length) {
    const derbyPlayers = [sagrado[0].playerId, ...ids.filter((id) => id !== sagrado[0].playerId).slice(0, 3)];
    const [d] = await call('CALL CreateMatch(?, NULL, 0, ?, NOW(), TRUE, ?, NULL, ?, ?)', [
      t, 'VERIFY', json(derbyPlayers.map((playerId) => ({ playerId, team: null }))), 'P', '[]',
    ]);
    await expectRow(
      'clasico con un Sagrado en Resto',
      'CALL SetMatchTeams(?, ?, ?)',
      [d.matchId, json(derbyPlayers.map((playerId, i) => ({ playerId, team: i < 2 ? 'R' : 'S' }))), '[]'],
      (rows) => (rows[0]?.state === 'R' ? null : `state=${rows[0]?.state}`),
    );
    await expectErrno('clasico con colores D/L', 46302, 'CALL UpdateMatch(?, NULL, 0, ?, NOW(), TRUE, ?, NULL, ?, ?)', [
      d.matchId, 'VERIFY', json(derbyPlayers.map((playerId, i) => ({ playerId, team: i < 2 ? 'D' : 'L' }))), 'R', '[]',
    ]);
  } else {
    console.log('  skip clasico: no hay jugadores Sagrado activos');
  }

  // ── 12. team maker: recorrido completo ─────────────────────────────────────
  const eight = ids.slice(0, 6).map((playerId) => ({ playerId, team: null }));
  const [m3row] = await call('CALL CreateMatch(?, NULL, 0, ?, NOW(), FALSE, ?, NULL, ?, ?)', [
    t, 'VERIFY', json(eight), 'P', json([{ name: 'Hernán', team: null }, { name: 'Primo', team: null }]),
  ]);
  const m3 = m3row.matchId;
  const [mk] = await expectRow('CreateTeamMaker', 'CALL CreateTeamMaker(?, ?)', [m3, 'codigocodigocodigocodi'], (rows) =>
    rows[0]?.makerId ? null : 'sin makerId',
  );
  const makerId = mk?.makerId;
  await expectErrno('segundo maker activo', 46309, 'CALL CreateTeamMaker(?, ?)', [m3, 'otrocodigootrocodigoot']);

  const [, , , roster] = (await db.query('CALL GetTeamMakerByMatch(?)', [m3]))[0];
  const guestIds = roster.filter((r) => r.kind === 'G').map((r) => r.id);
  // Un random no tiene id de jugador: lo que el SP puede rechazar es un id que no
  // es de ningún jugador. (Pasarle el guestId era un falso caso: con la tabla de
  // randoms recién creada el guestId 1 coincide con el jugador 1, que está convocado.)
  const [[{ noPlayer }]] = await db.query('SELECT COALESCE(MAX(playerId), 0) + 1000 AS noPlayer FROM Players');
  await expectErrno('reclamar con un id que no es de un jugador', 46601, 'CALL ClaimTeamMakerSeat(?, ?, ?, ?)', [makerId, 0, noPlayer, 'h']);
  await expectErrno('reclamar con alguien no convocado', 46601, 'CALL ClaimTeamMakerSeat(?, ?, ?, ?)', [makerId, 0, ids[7], 'h']);
  await call('CALL ClaimTeamMakerSeat(?, ?, ?, ?)', [makerId, 0, ids[0], 'hash0']);
  await expectErrno('el mismo jugador en los dos lugares', 46601, 'CALL ClaimTeamMakerSeat(?, ?, ?, ?)', [makerId, 1, ids[0], 'hash1']);
  await call('CALL ClaimTeamMakerSeat(?, ?, ?, ?)', [makerId, 1, ids[1], 'hash1']);
  await expectErrno('otro jugador en un lugar ya tomado', 46601, 'CALL ClaimTeamMakerSeat(?, ?, ?, ?)', [makerId, 1, ids[2], 'x']);
  await expectRow('reclamar de nuevo el propio lugar', 'CALL ClaimTeamMakerSeat(?, ?, ?, ?)', [makerId, 1, ids[1], 'hash1b'], () => null);

  await expectRow('GetCaptainPositions', 'CALL GetCaptainPositions(?, ?, ?)', [m3, ids[0], ids[1]], (rows) =>
    rows.length === 1 && 'pos0' in rows[0] && 'pos1' in rows[0] ? null : JSON.stringify(rows),
  );
  await call('CALL StartTeamMakerPicking(?, ?, ?)', [makerId, 0, true]);
  // 8 en total: 6 elecciones, orden A B B A A B
  const picks = [
    [0, 0, ids[2], null], [1, 1, ids[3], null], [2, 1, null, guestIds[0]],
    [3, 0, ids[4], null], [4, 0, null, guestIds[1]], [5, 1, ids[5], null],
  ];
  for (const [turn, seat, playerId, guestId] of picks) {
    if (turn === 5) {
      // Antes de la ultima: repetir un turno ya jugado lo frena la PK.
      await expectErrno('elegir dos veces el mismo turno', 1062, 'CALL AddTeamMakerPick(?, ?, ?, ?, ?, ?)', [
        makerId, 4, 0, ids[5], null, false,
      ]);
    }
    await call('CALL AddTeamMakerPick(?, ?, ?, ?, ?, ?)', [makerId, turn, seat, playerId, guestId, turn === 5]);
  }
  await expectErrno('elegir con el maker ya votando', 46601, 'CALL AddTeamMakerPick(?, ?, ?, ?, ?, ?)', [
    makerId, 6, 1, ids[5], null, true,
  ]);
  await call('CALL SetTeamMakerVote(?, ?, ?)', [makerId, 0, 'D']);
  await call('CALL SetTeamMakerVote(?, ?, ?)', [makerId, 1, 'D']);
  await expectRow('FinishTeamMaker -> partido R con 4 y 4', 'CALL FinishTeamMaker(?, ?, ?, ?)', [makerId, 'L', 'D', 1], (rows) => {
    const m = rows[0];
    const all = [...parse(m.players), ...parse(m.guests)];
    const d = all.filter((p) => p.team === 'D').length;
    return m.state === 'R' && d === 4 && all.length === 8 ? null : `state=${m.state} D=${d} total=${all.length}`;
  });

  // ── 13. cancelar vuelve a preparacion ─────────────────────────────────────
  await call('CALL ClearMatchTeams(?)', [m3]);
  const [mk2] = await call('CALL CreateTeamMaker(?, ?)', [m3, 'tercercodigotercercodi']);
  await call('CALL ClaimTeamMakerSeat(?, ?, ?, ?)', [mk2.makerId, 0, ids[0], 'h']);
  await expectRow('RestartTeamMaker libera lugares', 'CALL RestartTeamMaker(?, ?)', [mk2.makerId, 'cuartocodigocuartocodi'], () => null);
  const [[seatsAfter]] = await db.query('SELECT COUNT(playerId) AS n FROM TeamMakerSeats WHERE makerId = ?', [mk2.makerId]);
  if (seatsAfter.n !== 0) fail('RestartTeamMaker libera lugares', `quedan ${seatsAfter.n}`);
  await expectRow('CancelTeamMaker -> partido P sin equipos', 'CALL CancelTeamMaker(?)', [mk2.makerId], (rows) =>
    rows[0]?.state === 'P' && parse(rows[0].players).every((p) => p.team === null) ? null : `state=${rows[0]?.state}`,
  );
  await expectRow('sin maker activo, el partido se edita', 'CALL UpdateMatch(?, NULL, 0, ?, NOW(), FALSE, ?, NULL, ?, ?)', [
    m3, 'VERIFY', json(eight), 'P', json([{ name: 'Hernán', team: null }]),
  ], () => null);
} catch (e) {
  fail('ejecucion', e.message);
} finally {
  if (tournamentId) {
    await db.query('DELETE FROM Matches WHERE tournamentId = ?', [tournamentId]);
    await db.query('DELETE FROM Tournaments WHERE tournamentId = ?', [tournamentId]);
  }
  await db.end();
}

if (failures) {
  console.error(`FALLA: ${failures} casos`);
  process.exitCode = 1;
} else {
  console.log('OK: ciclo de vida del partido');
}
