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
 * Posiciones de un jugador en torneos finalizados. Ultimo, penultimo y
 * antepenultimo solo cuentan en torneos de cinco jugadores o mas: en uno de
 * tres, el "antepenultimo" es el campeon.
 */
function expectedPositions(standingsByTournament) {
  const facts = new Map();
  for (const [, table] of standingsByTournament) {
    const players = table.length;
    for (const row of table) {
      const entry = facts.get(row.playerId) ??
        { championships: 0, runnerUps: 0, bottomTwo: 0, thirdFromBottom: 0 };
      if (row.position === 1) entry.championships += 1;
      if (row.position === 2) entry.runnerUps += 1;
      if (players >= 5 && row.position >= players - 1) entry.bottomTwo += 1;
      if (players >= 5 && row.position === players - 2) entry.thirdFromBottom += 1;
      facts.set(row.playerId, entry);
    }
  }
  return facts;
}

/**
 * Los dos hechos que salen de mirar quien iba primero fecha por fecha, que son
 * los unicos del catalogo que dependen de la historia interna de un torneo y no
 * de como termino.
 *
 * chokedRuns (Pechofrio): torneos finalizados que el jugador NO gano habiendo
 * estado primero en las TRES fechas previas a la ultima. Es el espejo de Puro
 * Huevo: misma ventana, cuantificador opuesto. Un mismo torneo puede repartir
 * los dos logros a dos jugadores distintos.
 *
 * comebackTitles (Puro Huevo): torneos ganados sin haber estado primero en
 * ninguna de las TRES fechas previas a la ultima. Lo de antes no cuenta: se
 * puede haber liderado media temporada, perdido la punta y recuperarla justo
 * en la fecha final.
 *
 * Recibe las tablas fecha a fecha ya calculadas en JavaScript por
 * expectedMatchdayStandings, asi que el campeon sale de la ultima fecha —el que
 * quedo primero cuando ya no quedaban partidos— y no de preguntarle a la base
 * quien gano.
 */
function expectedLeadFacts(tablesByTournament) {
  const facts = new Map();

  const entryFor = (playerId) => {
    if (!facts.has(playerId)) {
      facts.set(playerId, { chokedRuns: 0, comebackTitles: 0 });
    }
    return facts.get(playerId);
  };

  for (const [, tables] of tablesByTournament) {
    if (tables.length === 0) continue;

    // Un lider por fecha: la tabla esta numerada 1..N sin empates.
    const leaders = tables.map((table) => table.find((row) => row.position === 1).playerId);
    const champion = leaders[leaders.length - 1];

    // La ventana son las tres fechas previas a la ultima: como leaders[i] es la
    // fecha i+1, salen de los tres anteultimos elementos del array. En un
    // torneo corto slice devuelve los que haya, y en uno de una sola fecha
    // queda vacia: ahi no hay ventana ni para liderar ni para remontar.
    const window = leaders.slice(-4, -1);
    if (window.length === 0) continue;

    // Puro Huevo: el campeon no lidero ninguna de las tres.
    if (!window.includes(champion)) {
      entryFor(champion).comebackTitles += 1;
    }

    // Pechofrio: alguien que NO es el campeon las lidero todas. Como hay un
    // solo lider por fecha, que las tres sean del mismo jugador equivale a que
    // el conjunto de lideres tenga un elemento, y que ese no sea el campeon.
    const windowLeaders = new Set(window);
    if (windowLeaders.size === 1) {
      const [only] = windowLeaders;
      if (only !== champion) entryFor(only).chokedRuns += 1;
    }
  }

  return facts;
}

/**
 * La ultima fecha ANTERIOR A LA FINAL en la que cada jugador estuvo primero en
 * cada torneo, y cuantas fechas tuvo ese torneo. Null cuando nunca lidero antes
 * de la ultima, que es el caso del campeon que da la vuelta sobre la chicharra.
 *
 * Son los dos operandos de la comparacion de la que sale comebackTitles: un
 * titulo es remontada cuando ese numero queda por debajo de la ventana de tres
 * fechas. Se verifican por separado porque el hecho final es un booleano por
 * torneo y no distingue entre "no lidero nunca" y "lidero al principio": estos
 * dos numeros si, y valen de todo.
 *
 * Devuelve un mapa con clave "torneo:jugador" para poder comparar fila por fila
 * y que el mensaje de error muestre los dos numeros.
 */
function expectedLastLeads(tablesByTournament) {
  const lastLeads = new Map();
  for (const [tournamentId, tables] of tablesByTournament) {
    for (let i = 0; i < tables.length; i++) {
      const leader = tables[i].find((row) => row.position === 1).playerId;
      const key = `${tournamentId}:${leader}`;
      const entry = lastLeads.get(key) ?? {
        tournamentId,
        playerId: leader,
        lastLeadBeforeFinal: null,
        matchdays: tables.length,
      };
      // La ultima fecha no cuenta: el campeon siempre la lidera.
      if (i + 1 < tables.length) entry.lastLeadBeforeFinal = i + 1;
      lastLeads.set(key, entry);
    }
  }
  return lastLeads;
}

/**
 * Las columnas que vPlayerAchievementFacts no calcula: las copia tal cual de
 * otra vista. Cada tupla es [vista fuente, columna alla, columna aca].
 *
 * Que el numero de la fuente este bien ya lo verifican las comprobaciones de
 * arriba; lo que nadie miraba es el CABLEADO. Un COALESCE(att.bestAbsenceStreak)
 * saliendo por la columna bestAttendanceStreak, o un pk joineado contra la
 * vista equivocada, pasaria todas las demas comprobaciones en verde porque
 * todas leen las vistas FUENTE y no esta.
 */
const PASS_THROUGH_COLUMNS = [
  ['vGeneralScoreboard',       'played',               'played'],
  ['vGeneralScoreboard',       'drew',                 'draws'],
  ['vGeneralScoreboard',       'points',               'points'],
  ['vPlayerStreaks',           'bestWin',              'bestWinStreak'],
  ['vPlayerStreaks',           'worstLoss',            'worstLossStreak'],
  ['vPlayerGoalDiffPeaks',     'peakGoalDiff',         'peakGoalDiff'],
  ['vPlayerGoalDiffPeaks',     'floorGoalDiff',        'floorGoalDiff'],
  ['vPlayerAttendanceStreaks', 'bestAttendanceStreak', 'bestAttendanceStreak'],
  ['vPlayerAttendanceStreaks', 'bestAbsenceStreak',    'bestAbsenceStreak'],
  ['vMundialitoPlayerStats',   'titles',               'mundialitoTitles'],
  ['vMundialitoPlayerStats',   'perfectRuns',          'perfectRuns'],
  ['vMundialitoPlayerStats',   'semis',                'semiRuns'],
  ['vMundialitoPlayerStats',   'bestSlot',             'bestSlot'],
];

/**
 * Completa un mapa de hechos con TODOS los jugadores: el que nunca jugo (o
 * nunca lidero nada) tiene que aparecer igual, en cero, porque
 * vPlayerAchievementFacts devuelve una fila por jugador y sin esto
 * compareByPlayerId contaria de mas cada jugador sin hechos.
 */
function withEveryPlayer(playerIds, facts, zero) {
  const complete = new Map();
  for (const playerId of playerIds) {
    complete.set(playerId, facts.get(playerId) ?? { ...zero });
  }
  return complete;
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
 * Incluye matchdays, el total de fechas del torneo que viaja repetido en cada
 * fila. Es la columna de la que sale "es la ultima fecha" —y con eso Puro
 * Huevo—, y es un candidato perfecto a error silencioso: si estuviera de mas en
 * uno, comebackTitles seguiria dando cero para todos y nadie se enteraria.
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
        // El total de fechas es, sencillamente, cuantas tablas se armaron.
        expectedByKey.set(
          `${tournamentId}:${matchday}:${row.playerId}`,
          { ...row, matchdays: tables.length },
        );
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

    if (Number(row.matchdays) !== want.matchdays) {
      problems.push(
        `torneo ${row.tournamentId} fecha ${row.matchday} jugador ${row.playerId}: ` +
        `matchdays base ${row.matchdays}, esperado ${want.matchdays}`,
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

/**
 * Compara los dos operandos de comebackTitles por (torneo, jugador), en las dos
 * direcciones. Otra clave compuesta, asi que tampoco entra en compareByPlayerId.
 *
 * lastLeadBeforeFinal es el unico numero nullable de todo el verificador: null
 * significa "nunca lidero antes de la ultima fecha", y hay que compararlo como
 * null y no como cero, porque cero seria una fecha que no existe.
 */
function compareLastLeads(expected, actual) {
  const problems = [];
  const seen = new Set();
  const show = (value) => (value === null ? 'null' : value);

  for (const row of actual) {
    const key = `${row.tournamentId}:${row.playerId}`;
    seen.add(key);
    const want = expected.get(key);

    if (!want) {
      problems.push(
        `ultimo liderazgo: torneo ${row.tournamentId} jugador ${row.playerId} figura como lider y no lidero nunca`,
      );
      continue;
    }

    const actualLast = row.lastLeadBeforeFinal === null ? null : Number(row.lastLeadBeforeFinal);
    if (actualLast !== want.lastLeadBeforeFinal) {
      problems.push(
        `ultimo liderazgo: torneo ${row.tournamentId} jugador ${row.playerId} ` +
        `lastLeadBeforeFinal base ${show(actualLast)}, esperado ${show(want.lastLeadBeforeFinal)}`,
      );
    }
    if (Number(row.matchdays) !== want.matchdays) {
      problems.push(
        `ultimo liderazgo: torneo ${row.tournamentId} jugador ${row.playerId} ` +
        `matchdays base ${row.matchdays}, esperado ${want.matchdays}`,
      );
    }
  }

  for (const [key, want] of expected) {
    if (!seen.has(key)) {
      problems.push(
        `ultimo liderazgo: falta ${key}, lidero hasta la fecha ${show(want.lastLeadBeforeFinal)} y la base no lo trae`,
      );
    }
  }

  return problems;
}

/**
 * Las 28 reglas, escritas una por una contra los hechos. Es deliberadamente
 * repetitivo: si esto y el SQL coinciden, los dos dicen lo mismo.
 *
 * 'U' obtenido, 'L' bloqueado, 'B' roto (la maldicion ya no se puede conseguir).
 *
 * Devuelve {state, progress, target} por logro, no solo el estado: un cambio
 * que deje el CASE del estado intacto pero mueva el target o el signo del
 * progress (por ejemplo el target de EZ de 8 a 80) no toca ningun state y
 * pasaria de largo si esta funcion solo comparara eso. progress/target van en
 * null en los logros de evento, igual que en la vista.
 */
function expectedStates(f) {
  const reached = (value, target) => (value >= target ? 'U' : 'L');
  const withProgress = (state, progress, target) => ({ state, progress, target });
  return {
    CAZADOR:           withProgress(reached(f.maxWinMargin, 10), f.maxWinMargin, 10),
    LA_CAMA:           withProgress(reached(f.maxLossMargin, 10), f.maxLossMargin, 10),
    CORONADOS:         withProgress(reached(f.championships, 1), null, null),
    PRIMER_PERDEDOR:   withProgress(reached(f.runnerUps, 1), null, null),
    ESTAMOS_EN_LA_B:   withProgress(reached(f.bottomTwo, 1), null, null),
    LA_PROMOCION:      withProgress(reached(f.thirdFromBottom, 1), null, null),
    MANO_A_MANO:       withProgress(reached(f.draws, 10), f.draws, 10),
    EL_CORNUDO:        withProgress(reached(f.bestWinStreak, 10), f.bestWinStreak, 10),
    DEJALO_AMIGO:      withProgress(reached(f.worstLossStreak, 10), f.worstLossStreak, 10),
    COLECCIONISTA:     withProgress(reached(f.points, 100), Math.floor(f.points), 100),
    PERRO_VIEJO:       withProgress(reached(f.played, 50), f.played, 50),
    BUSCATE_UN_LABURO: withProgress(reached(f.bestAttendanceStreak, 20), f.bestAttendanceStreak, 20),
    SE_BUSCA:          withProgress(reached(f.bestAbsenceStreak, 10), f.bestAbsenceStreak, 10),
    PICHICHI:          withProgress(reached(f.peakGoalDiff, 50), f.peakGoalDiff, 50),
    PICHI:             withProgress(f.floorGoalDiff <= -50 ? 'U' : 'L', -f.floorGoalDiff, 50),
    PECHOFRIO:         withProgress(reached(f.chokedRuns, 1), null, null),
    PURO_HUEVO:        withProgress(reached(f.comebackTitles, 1), null, null),
    EX_EQUIPO:         withProgress(reached(f.maxDerbyLossMargin, 7), f.maxDerbyLossMargin, 7),
    HERMOSA_MANIANA:   withProgress(reached(f.maxDerbyWinMargin, 7), f.maxDerbyWinMargin, 7),
    LEYENDA:           withProgress(reached(f.derbiesPlayed, 8), f.derbiesPlayed, 8),
    CAMPEON_DEL_MUNDO: withProgress(reached(f.mundialitoTitles, 1), null, null),
    JUEGUEN_ENSERIO:   withProgress(reached(f.unbeatenTitles, 1), null, null),
    INVENTEN_DEPORTE:  withProgress(reached(f.perfectRuns, 1), null, null),
    // Las dos maldiciones: primero se pregunta si ya se rompio.
    MEXICANO:          withProgress(f.bestSlot >= 5 ? 'B' : reached(f.shortRuns, 5), f.shortRuns, 5),
    ETERNO_CANDIDATO:  withProgress(f.mundialitoTitles >= 1 ? 'B' : reached(f.semiRuns, 4), f.semiRuns, 4),
    REPECHAJE:         withProgress(reached(f.groupZeroRuns, 1), null, null),
    EZ:                withProgress(reached(f.maxFinalWinMargin, 8), f.maxFinalWinMargin, 8),
    DIA_PARA_OLVIDO:   withProgress(reached(f.maxFinalLossMargin, 8), f.maxFinalLossMargin, 8),
  };
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

  // Aca vivia un `SET SESSION internal_tmp_mem_storage_engine = 'MEMORY'`: con
  // las 28 ramas UNION ALL de la vista vieja, leer vPlayerAchievements sin
  // filtro fallaba con "Table './tmp/#sql...' doesn't exist" por el bug del
  // motor TempTable de MySQL 8.4 (bugs.mysql.com/112704). Desde que la vista
  // evalua los hechos una sola vez con LATERAL no hace falta: ya no hay
  // materializacion compartida entre ramas que el motor libere antes de
  // tiempo. Ver el comentario de vPlayerAchievements en database/views.sql.

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
      'SELECT tournamentId, `state`, winningPoints, drawingPoints, lossingPoints FROM Tournaments',
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
      'SELECT tournamentId, matchday, matchdays, playerId, points, goalsDiference, netPoints, ' +
      'winRate, `position` FROM vTournamentMatchdayStandings',
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

    // -------------------------------------------------------------------------
    // Hechos de torneo: posiciones finales
    // -------------------------------------------------------------------------
    const [allPlayers] = await connection.query('SELECT playerId FROM Players');
    const playerIds = allPlayers.map((row) => row.playerId);

    const [finalStandings] = await connection.query(`
      SELECT st.tournamentId, st.playerId, st.position
      FROM vTournamentStandings st
      INNER JOIN Tournaments t ON t.tournamentId = st.tournamentId
      WHERE t.state = 'F'
    `);

    const standingsByTournament = new Map();
    for (const row of finalStandings) {
      if (!standingsByTournament.has(row.tournamentId)) {
        standingsByTournament.set(row.tournamentId, []);
      }
      standingsByTournament.get(row.tournamentId).push({
        playerId: row.playerId,
        position: Number(row.position),
      });
    }

    const expectedPositionFacts = withEveryPlayer(
      playerIds,
      expectedPositions(standingsByTournament),
      { championships: 0, runnerUps: 0, bottomTwo: 0, thirdFromBottom: 0 },
    );

    const [actualFacts] = await connection.query('SELECT * FROM vPlayerAchievementFacts');

    const positionProblems = compareByPlayerId(
      expectedPositionFacts,
      actualFacts,
      ['championships', 'runnerUps', 'bottomTwo', 'thirdFromBottom'],
      'posiciones en torneos',
    );

    if (positionProblems.length > 0) {
      console.error(`[verify] ${positionProblems.length} DIFERENCIAS en posiciones de torneo:`);
      for (const problem of positionProblems.slice(0, 40)) console.error(`  - ${problem}`);
      if (positionProblems.length > 40) {
        console.error(`  ... y ${positionProblems.length - 40} mas`);
      }
      process.exitCode = 1;
    } else {
      console.log('posiciones en torneos OK');
    }

    // -------------------------------------------------------------------------
    // Hechos de torneo: liderazgos fecha a fecha (Pechofrio y Puro Huevo)
    // -------------------------------------------------------------------------
    // Los dos hechos mas retorcidos del catalogo, y los unicos que no se pueden
    // leer de ninguna tabla final. Se calculan sobre las tablas fecha a fecha
    // que este mismo script ya armo en JavaScript mas arriba, filtradas a los
    // torneos finalizados: uno en curso no tiene campeon todavia.
    const finishedTables = new Map();
    for (const tournament of tournaments) {
      if (tournament.state !== 'F') continue;
      finishedTables.set(tournament.tournamentId, expectedByTournament.get(tournament.tournamentId));
    }

    const expectedLeads = withEveryPlayer(
      playerIds,
      expectedLeadFacts(finishedTables),
      { chokedRuns: 0, comebackTitles: 0 },
    );

    const leadFactProblems = compareByPlayerId(
      expectedLeads,
      actualFacts,
      ['chokedRuns', 'comebackTitles'],
      'liderazgos fecha a fecha',
    );

    // Y los dos operandos de los que sale comebackTitles, por separado. El hecho
    // final es un booleano por torneo: no distingue entre el campeon que no
    // lidero nunca y el que lidero al principio y se cayo, que son los dos
    // remontada. Estos dos numeros si, y valen de todo: ultimos liderazgos
    // null, 2, 4, 22 y 23 sobre torneos de 1, 5, 15, 23 y 24 fechas.
    //
    // Aca entran TODOS los torneos, no solo los finalizados: la subquery de la
    // vista tampoco los filtra —el filtro se lo pone el join contra
    // vTournamentChampions— y de paso suma el torneo en curso.
    const [actualLastLeads] = await connection.query(`
      SELECT ms.tournamentId, ms.playerId,
             MAX(CASE WHEN ms.matchday < ms.matchdays THEN ms.matchday END) AS lastLeadBeforeFinal,
             MAX(ms.matchdays) AS matchdays
      FROM vTournamentMatchdayStandings ms
      WHERE ms.\`position\` = 1
      GROUP BY ms.tournamentId, ms.playerId
    `);

    const lastLeadProblems = compareLastLeads(
      expectedLastLeads(expectedByTournament),
      actualLastLeads,
    );

    const leadProblems = [...leadFactProblems, ...lastLeadProblems];

    if (leadProblems.length > 0) {
      console.error(`[verify] ${leadProblems.length} DIFERENCIAS en liderazgos fecha a fecha:`);
      for (const problem of leadProblems.slice(0, 40)) console.error(`  - ${problem}`);
      if (leadProblems.length > 40) console.error(`  ... y ${leadProblems.length - 40} mas`);
      process.exitCode = 1;
    } else {
      console.log('liderazgos fecha a fecha OK');
    }

    // -------------------------------------------------------------------------
    // Cableado de las columnas que la vista solo copia
    // -------------------------------------------------------------------------
    // Esta comprobacion no verifica ninguna regla: verifica que cada columna
    // salga de la vista que dice salir. Es lo unico que ata
    // vPlayerAchievementFacts a sus fuentes, porque todas las demas
    // comprobaciones leen las fuentes directamente y un cable cruzado adentro de
    // la vista les pasaria por al lado.
    const expectedWiring = new Map(playerIds.map((playerId) => [playerId, {}]));

    for (const view of new Set(PASS_THROUGH_COLUMNS.map(([source]) => source))) {
      const columns = PASS_THROUGH_COLUMNS.filter(([source]) => source === view);
      const [sourceRows] = await connection.query(
        `SELECT playerId, ${columns.map(([, from]) => `\`${from}\``).join(', ')} FROM ${view}`,
      );
      const byPlayer = new Map(sourceRows.map((row) => [row.playerId, row]));

      for (const playerId of playerIds) {
        const source = byPlayer.get(playerId);
        for (const [, from, to] of columns) {
          // El jugador que no esta en la vista fuente (nunca jugo, nunca
          // asistio) tiene que salir en cero, que es lo que promete el COALESCE.
          expectedWiring.get(playerId)[to] = source ? Number(source[from]) : 0;
        }
      }
    }

    const wiringProblems = compareByPlayerId(
      expectedWiring,
      actualFacts,
      PASS_THROUGH_COLUMNS.map(([, , to]) => to),
      'cableado de columnas',
    );

    if (wiringProblems.length > 0) {
      console.error(`[verify] ${wiringProblems.length} DIFERENCIAS en el cableado de columnas:`);
      for (const problem of wiringProblems.slice(0, 40)) console.error(`  - ${problem}`);
      if (wiringProblems.length > 40) console.error(`  ... y ${wiringProblems.length - 40} mas`);
      process.exitCode = 1;
    } else {
      console.log(`cableado de ${PASS_THROUGH_COLUMNS.length} columnas OK`);
    }

    // -------------------------------------------------------------------------
    // Estados de los 28 logros (vPlayerAchievements)
    // -------------------------------------------------------------------------
    // expectedStates() son las 28 reglas escritas una por una contra los
    // hechos, sin traducir el SQL de la vista a JS. actualFacts ya trae una
    // fila por jugador (incluido el que nunca jugo, en cero) de la comparacion
    // de cableado de arriba. Se comparan las tres columnas -state, progress y
    // target-, no solo el estado: un target corrido o un progress con el signo
    // cambiado no mueve ningun state y pasaria de largo si solo se mirara eso.
    //
    // Ademas se verifican tres cosas baratas: que cada jugador tenga
    // exactamente 28 filas (ni una rama de mas ni de menos), que todo code que
    // devuelve la vista exista en Achievements (el bug de truncamiento del
    // UNION que documenta vMundialitoRuns entraria aca: un code truncado nunca
    // calza con el catalogo) y, al reves, que todo code de Achievements
    // aparezca en la vista -si se agrega un logro 29 al catalogo y se olvida la
    // rama, esto lo agarra-.
    const [catalog] = await connection.query('SELECT code FROM Achievements');
    const catalogCodes = new Set(catalog.map((row) => row.code));

    const [actualStates] = await connection.query(
      'SELECT playerId, code, state, progress, target FROM vPlayerAchievements',
    );

    const expectedByKey = new Map();
    for (const facts of actualFacts) {
      for (const [code, want] of Object.entries(expectedStates(facts))) {
        expectedByKey.set(`${facts.playerId}:${code}`, want);
      }
    }

    const stateProblems = [];
    const rowCountByPlayer = new Map();
    const unknownCodes = new Set();
    const codesInView = new Set();
    const seenKeys = new Set();

    for (const row of actualStates) {
      rowCountByPlayer.set(row.playerId, (rowCountByPlayer.get(row.playerId) ?? 0) + 1);
      codesInView.add(row.code);
      if (!catalogCodes.has(row.code)) unknownCodes.add(row.code);

      const key = `${row.playerId}:${row.code}`;
      seenKeys.add(key);
      const want = expectedByKey.get(key);
      if (want === undefined) {
        stateProblems.push(
          `estados: jugador ${row.playerId} code ${row.code} aparece en la vista y no deberia`,
        );
        continue;
      }
      if (row.state !== want.state) {
        stateProblems.push(
          `estados: jugador ${row.playerId} ${row.code} state: base ${row.state}, esperado ${want.state}`,
        );
      }
      const actualProgress = row.progress === null ? null : Number(row.progress);
      if (actualProgress !== want.progress) {
        stateProblems.push(
          `estados: jugador ${row.playerId} ${row.code} progress: base ${row.progress}, esperado ${want.progress}`,
        );
      }
      const actualTarget = row.target === null ? null : Number(row.target);
      if (actualTarget !== want.target) {
        stateProblems.push(
          `estados: jugador ${row.playerId} ${row.code} target: base ${row.target}, esperado ${want.target}`,
        );
      }
    }

    for (const key of expectedByKey.keys()) {
      if (!seenKeys.has(key)) {
        stateProblems.push(`estados: falta ${key}, la vista no la devuelve`);
      }
    }

    for (const playerId of playerIds) {
      const count = rowCountByPlayer.get(playerId) ?? 0;
      if (count !== 28) {
        stateProblems.push(`estados: jugador ${playerId} tiene ${count} filas, esperadas 28`);
      }
    }

    if (unknownCodes.size > 0) {
      stateProblems.push(
        `estados: codes que no existen en Achievements, posible truncamiento del UNION: ${[...unknownCodes].join(', ')}`,
      );
    }

    const missingCodes = [...catalogCodes].filter((code) => !codesInView.has(code));
    if (missingCodes.length > 0) {
      stateProblems.push(
        `estados: codes de Achievements que la vista nunca devuelve: ${missingCodes.join(', ')}`,
      );
    }

    if (stateProblems.length > 0) {
      console.error(`[verify] ${stateProblems.length} DIFERENCIAS en estados de logros:`);
      for (const problem of stateProblems.slice(0, 40)) console.error(`  - ${problem}`);
      if (stateProblems.length > 40) console.error(`  ... y ${stateProblems.length - 40} mas`);
      process.exitCode = 1;
    } else {
      console.log('estados de logros OK (28 por jugador, state/progress/target, codes en las dos direcciones)');
    }
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(`[verify] ERROR: ${error.message}`);
  process.exit(1);
});
