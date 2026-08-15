#!/usr/bin/env node
/**
 * Migra la historia completa desde el sistema de Google Apps Script.
 *
 * La fuente es la constante SEED de docs/Codigo.gs: el JSON que el script usaba
 * para sembrar sus planillas. De ahi salen jugadores, torneos y los 71 partidos
 * de 2025 y 2026.
 *
 * Todo entra por los stored procedures, no por INSERT directo. Es a proposito:
 * si el seed pasa, quedan probadas de punta a punta las mismas validaciones que
 * va a usar el frontend.
 *
 * Uso:
 *   node scripts/seed.mjs          # falla si ya hay datos
 *   node scripts/seed.mjs --force  # BORRA todo y vuelve a cargar
 *   node scripts/seed.mjs --dry    # solo informa que haria
 *
 * Ver EL TORNEO 2024 mas abajo para el caso especial de wasTracked = false.
 */
import { createConnection } from 'mysql2/promise';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, '..', 'docs', 'Codigo.gs');

const FORCE = process.argv.includes('--force');
const DRY_RUN = process.argv.includes('--dry');

// ─────────────────────────── Configuracion ───────────────────────────────────

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

// ─────────────────────────── Lectura de la fuente ─────────────────────────────

/**
 * Extrae el JSON de la constante SEED de Codigo.gs.
 *
 * En el archivo es un literal de string de JavaScript que CONTIENE JSON, asi
 * que hay dos capas: primero se desescapa el literal, despues se parsea el JSON.
 */
function readLegacyData() {
  if (!existsSync(SOURCE)) {
    throw new Error(`No encuentro ${SOURCE}`);
  }

  const source = readFileSync(SOURCE, 'utf8');
  const match = source.match(/var SEED = ("(?:[^"\\]|\\.)*");/s);

  if (!match) {
    throw new Error('No pude ubicar la constante SEED en Codigo.gs');
  }

  return JSON.parse(JSON.parse(match[1]));
}

// ─────────────────────────── Nombres ──────────────────────────────────────────

/**
 * El sistema viejo guardaba UN nombre por jugador ("Bauti", "Facu LG"); el
 * modelo nuevo pide nombre y apellido.
 *
 * Se conserva el nombre original como apodo —que es lo que se muestra en todas
 * las tablas— y se parte en dos lo que se pueda. Para los de una sola palabra
 * el apellido queda en "-": es un placeholder visible, para que se note que
 * falta y alguien lo complete desde la pantalla de administracion, en vez de
 * inventar un apellido que despues nadie sabria que es falso.
 */
function splitName(name) {
  const parts = name.trim().split(/\s+/);
  return {
    firstName: parts[0].slice(0, 20),
    secondName: (parts.slice(1).join(' ') || '-').slice(0, 20),
    nickname: name.slice(0, 20),
  };
}

// ─────────────────────────── EL TORNEO 2024 ───────────────────────────────────

/**
 * Del torneo 2024 solo sobrevivio la tabla final del Excel: por jugador,
 * cuantos jugo, gano, empato y perdio. Los partidos no se anotaron nunca.
 *
 * Como el modelo nuevo calcula TODO desde los partidos, hay que darle partidos.
 * Esta funcion arma el minimo juego de partidos sinteticos cuya tabla resultante
 * es exactamente la del Excel.
 *
 * El problema, formalmente: repartir a cada jugador sus w victorias y sus l
 * derrotas en partidos distintos (nadie juega dos veces el mismo partido), de
 * modo que cada partido tenga al menos un ganador y un perdedor.
 *
 * La cantidad de partidos no se elige: es max(w + l), porque el que mas jugo
 * necesita un partido distinto para cada aparicion.
 *
 * El reparto es un greedy con reintentos: se procesa a los jugadores de mas a
 * menos apariciones y cada uno elige los partidos menos poblados. Eso empareja
 * los equipos, que si no quedarian de 12 contra 1. Si una pasada deja un partido
 * sin alguno de los dos lados, se reintenta con otro orden.
 *
 * El generador aleatorio esta sembrado con una constante para que dos corridas
 * den el mismo resultado: si el seed se vuelve a correr, los partidos de 2024
 * son los mismos y no aparecen ids nuevos de la nada.
 */
function buildSyntheticMatches(baseline) {
  const players = Object.entries(baseline).map(([legacyId, row]) => ({
    legacyId,
    wins: row.won ?? 0,
    draws: row.drew ?? 0,
    losses: row.lost ?? 0,
    total: (row.won ?? 0) + (row.drew ?? 0) + (row.lost ?? 0),
  }));

  const withDraws = players.filter((player) => player.draws > 0);
  if (withDraws.length > 0) {
    // El 2024 no tuvo empates. Si alguna vez los hubiera, habria que ubicar a
    // los dos lados del mismo partido y el greedy de abajo no lo contempla:
    // mejor fallar ruidosamente que generar una tabla que no cierra.
    throw new Error(
      `El baseline trae empates (${withDraws.map((p) => p.legacyId).join(', ')}) ` +
        'y el generador todavia no los soporta.',
    );
  }

  const matchCount = Math.max(...players.map((player) => player.total));
  let random = mulberry32(20240101);

  for (let attempt = 0; attempt < 500; attempt++) {
    const matches = Array.from({ length: matchCount }, () => ({
      winners: [],
      losers: [],
    }));

    const order = shuffle(
      [...players].sort((a, b) => b.total - a.total),
      random,
    );

    let failed = false;

    for (const player of order) {
      const taken = new Set();

      // Primero las victorias, despues las derrotas: cada una elige entre los
      // partidos donde el jugador todavia no aparece, priorizando el lado menos
      // poblado para que los equipos queden parejos.
      if (!assign(matches, player, 'winners', player.wins, taken)) {
        failed = true;
        break;
      }
      if (!assign(matches, player, 'losers', player.losses, taken)) {
        failed = true;
        break;
      }
    }

    if (!failed && matches.every((m) => m.winners.length > 0 && m.losers.length > 0)) {
      return matches;
    }

    random = mulberry32(20240101 + attempt + 1);
  }

  throw new Error('No pude construir los partidos sinteticos de 2024');
}

function assign(matches, player, side, count, taken) {
  for (let i = 0; i < count; i++) {
    const candidates = matches
      .map((match, index) => ({ match, index }))
      .filter(({ index }) => !taken.has(index))
      .sort((a, b) => a.match[side].length - b.match[side].length);

    if (candidates.length === 0) return false;

    const chosen = candidates[0];
    chosen.match[side].push(player.legacyId);
    taken.add(chosen.index);
  }
  return true;
}

/** PRNG determinista: misma semilla, misma salida. */
function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(array, random) {
  const out = [...array];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ─────────────────────────── Carga ────────────────────────────────────────────

/** 'YYYY-MM-DD' -> DATETIME de MySQL, al mediodia UTC. */
function toDateTime(value, fallback) {
  const raw = value || fallback;
  return `${raw} 12:00:00`;
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

  try {
    const [[counts]] = await connection.query(
      'SELECT (SELECT COUNT(*) FROM Players) AS players, ' +
        '(SELECT COUNT(*) FROM Tournaments) AS tournaments',
    );

    if ((counts.players > 0 || counts.tournaments > 0) && !FORCE && !DRY_RUN) {
      throw new Error(
        `La base ya tiene datos (${counts.players} jugadores, ` +
          `${counts.tournaments} torneos). Usa --force para borrarlos y recargar.`,
      );
    }

    if (FORCE && !DRY_RUN) {
      log('borrando datos existentes');
      // El orden respeta las FKs. No se usa TRUNCATE justamente porque las FKs
      // lo rechazan; DELETE si las honra.
      await connection.query('DELETE FROM MatchPlayers');
      await connection.query('DELETE FROM Matches');
      await connection.query('DELETE FROM PlayerPenalties');
      await connection.query('DELETE FROM Tournaments');
      await connection.query('DELETE FROM Players');
      await connection.query('ALTER TABLE Players AUTO_INCREMENT = 1');
      await connection.query('ALTER TABLE Tournaments AUTO_INCREMENT = 1');
      await connection.query('ALTER TABLE Matches AUTO_INCREMENT = 1');
    }

    // ── Jugadores ──
    const playerIdByLegacyId = new Map();

    for (const legacyPlayer of data.players) {
      const { firstName, secondName, nickname } = splitName(legacyPlayer.name);

      if (DRY_RUN) {
        playerIdByLegacyId.set(legacyPlayer.id, 0);
        continue;
      }

      const [rows] = await connection.query('CALL CreatePlayer(?, ?, ?, ?, ?, ?)', [
        firstName,
        secondName,
        nickname,
        legacyPlayer.photo || null,
        false, // isSagrado: el sistema viejo no lo registraba
        'A',
      ]);
      playerIdByLegacyId.set(legacyPlayer.id, rows[0][0].playerId);
    }
    log(`jugadores: ${data.players.length}`);

    // ── Torneos y partidos ──
    let importedMatches = 0;
    let skippedScheduled = 0;
    let syntheticMatches = 0;

    // De mas viejo a mas nuevo: asi los ids quedan en orden cronologico.
    const tournaments = [...data.tournaments].sort((a, b) =>
      String(a.start).localeCompare(String(b.start)),
    );

    for (const legacyTournament of tournaments) {
      const baseline = legacyTournament.baseline ?? {};
      const hasBaseline = Object.keys(baseline).length > 0;
      const wasTracked = !legacyTournament.sinDetallePartidos;

      let tournamentId = 0;

      if (!DRY_RUN) {
        const [rows] = await connection.query(
          'CALL CreateTournament(?, ?, ?, ?, ?, ?, ?, ?)',
          [
            legacyTournament.name,
            toDateTime(legacyTournament.start, '2024-01-01'),
            toDateTime(legacyTournament.end, '2024-12-31'),
            'P', // nace en juego: los partidos solo entran en un torneo abierto
            wasTracked,
            legacyTournament.scoring.win,
            legacyTournament.scoring.draw,
            legacyTournament.scoring.loss,
          ],
        );
        tournamentId = rows[0][0].tournamentId;
      }

      // Partidos reales.
      for (const legacyMatch of legacyTournament.matches ?? []) {
        if (legacyMatch.programado) {
          // El modelo nuevo no tiene partidos programados: ver el informe.
          skippedScheduled++;
          continue;
        }

        const lineup = [
          ...(legacyMatch.oscuro ?? []).map((id) => ({
            playerId: playerIdByLegacyId.get(id),
            team: 'D',
          })),
          ...(legacyMatch.claro ?? []).map((id) => ({
            playerId: playerIdByLegacyId.get(id),
            team: 'L',
          })),
        ];

        if (lineup.length === 0) continue;

        const winnerTeam =
          legacyMatch.ganador === 'oscuro' ? 'D' : legacyMatch.ganador === 'claro' ? 'L' : null;

        if (!DRY_RUN) {
          await connection.query('CALL CreateMatch(?, ?, ?, ?, ?, ?, ?)', [
            tournamentId,
            winnerTeam,
            legacyMatch.dif ?? 0,
            legacyMatch.place || 'SIN REGISTRO',
            toDateTime(legacyMatch.date, legacyTournament.start),
            false, // el sistema viejo no distinguia derbies
            JSON.stringify(lineup),
          ]);
        }
        importedMatches++;
      }

      // Partidos sinteticos del torneo sin detalle (2024).
      if (hasBaseline) {
        const synthetic = buildSyntheticMatches(baseline);
        const start = new Date(`${legacyTournament.start}T12:00:00Z`);
        const end = new Date(`${legacyTournament.end}T12:00:00Z`);
        const step = (end.getTime() - start.getTime()) / (synthetic.length + 1);

        for (const [index, match] of synthetic.entries()) {
          const lineup = [
            ...match.winners.map((id) => ({
              playerId: playerIdByLegacyId.get(id),
              team: 'D',
            })),
            ...match.losers.map((id) => ({
              playerId: playerIdByLegacyId.get(id),
              team: 'L',
            })),
          ];

          const playedAt = new Date(start.getTime() + step * (index + 1));

          if (!DRY_RUN) {
            await connection.query('CALL CreateMatch(?, ?, ?, ?, ?, ?, ?)', [
              tournamentId,
              'D',
              // Diferencia 0: en 2024 no se anotaron los marcadores. El SP lo
              // acepta solo porque el torneo es wasTracked = FALSE.
              0,
              'SIN REGISTRO',
              playedAt.toISOString().slice(0, 19).replace('T', ' '),
              false,
              JSON.stringify(lineup),
            ]);
          }
          syntheticMatches++;
        }
      }

      // Penalizaciones del torneo.
      for (const [legacyPlayerId, value] of Object.entries(legacyTournament.pen ?? {})) {
        if (!value) continue;
        if (!DRY_RUN) {
          await connection.query('CALL CreatePlayerPenalty(?, ?, ?)', [
            tournamentId,
            playerIdByLegacyId.get(legacyPlayerId),
            value,
          ]);
        }
      }

      // Recien ahora se cierra: con el torneo finalizado no se pueden cargar
      // partidos, asi que el estado real se aplica al final.
      if (!DRY_RUN && legacyTournament.estado === 'finalizado') {
        await connection.query('CALL SetTournamentState(?, ?)', [tournamentId, 'F']);
      }

      log(
        `torneo "${legacyTournament.name}" (${legacyTournament.estado}` +
          `${wasTracked ? '' : ', sin detalle'})`,
      );
    }

    log(`partidos importados: ${importedMatches}`);
    if (syntheticMatches) log(`partidos sinteticos (2024): ${syntheticMatches}`);
    if (skippedScheduled) {
      log(`partidos programados omitidos: ${skippedScheduled} (el modelo no los contempla)`);
    }

    const generalPenalties = Object.keys(data.generalPen ?? {}).length;
    if (generalPenalties) {
      log(
        `ATENCION: ${generalPenalties} penalizaciones generales NO se migraron ` +
          '(el modelo solo admite penalizaciones por torneo)',
      );
    }

    if (DRY_RUN) {
      log('--dry: no se escribio nada');
    } else {
      log('listo');
    }
  } finally {
    await connection.end();
  }
}

function log(message) {
  process.stdout.write(`[seed] ${message}\n`);
}

main().catch((error) => {
  console.error(`[seed] ERROR: ${error.message}`);
  process.exit(1);
});
