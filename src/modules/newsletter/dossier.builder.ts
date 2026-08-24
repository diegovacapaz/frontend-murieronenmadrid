import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import type { Row, RowDataPacket } from '../../database/database.types';
import { MIN_MATCHES_FOR_RANKING } from '../stats/stats.service';
import type { Dossier, DossierEstado, HistorialPartido } from './interfaces/dossier';
import { MIN_AGAINST, MIN_TOGETHER, SNAPSHOT_VERSION } from './newsletter.constants';

/** Una fila de vMatchDetail: el partido con su convocatoria ya armada. */
interface MatchDetailDB extends Row {
  matchId: number;
  tournamentId: number;
  tournamentName: string;
  /** De Tournaments, que la vista no expone. El typeCast del pool ya lo hace boolean. */
  wasTracked: boolean;
  winnerTeam: string | null;
  goalsDiference: number;
  place: string;
  playedAt: Date;
  isDerby: boolean;
  /** Columna JSON; el typeCast del pool la entrega ya parseada. */
  players: Array<{ playerId: number; team: string; displayName: string }>;
}

/** Lo mínimo que el builder necesita saber de un jugador para recorrerlos. */
interface JugadorDB extends Row {
  playerId: number;
  displayName: string;
}

interface TorneoEnCursoDB extends Row {
  tournamentId: number;
}

interface MaxMatchIdDB extends Row {
  maxMatchId: number;
}

interface GroupLoreDB extends Row {
  groupLore: string | null;
}

interface PlayerLoreDB extends Row {
  playerId: number;
  notes: string;
}

/** Las dos piezas de lore que van al contexto. */
interface DossierLore {
  grupo: string | null;
  porJugador: Record<number, string>;
}

/**
 * Arma todo lo que el modelo necesita para escribir una edición.
 *
 * ## Por qué el snapshot son las respuestas de los SP tal cual
 *
 * La salida de esta función sirve para dos cosas a la vez: es el input de hoy y
 * es el "antes" de mañana. Si el snapshot tuviera una forma propia habría dos
 * objetos que hay que mantener en sincronía, y el día que se separen el diario
 * empieza a reportar cambios que no pasaron. Siendo el mismo objeto no pueden
 * divergir. Y para el modelo es mejor todavía: las dos fotos tienen forma
 * idéntica, así que diffearlas con código es recorrer las mismas claves.
 *
 * ## Por qué en serie y no en paralelo
 *
 * Son ~60 llamadas a procedures. A las cinco de la mañana la latencia no le
 * importa a nadie, y en serie se esquiva el problema de TempTable de MySQL 8.4
 * que ya mordió con la solapa de logros: varias consultas pesadas a la vez se
 * caen con "Table './tmp/#sql...' doesn't exist". Además `GetPlayerAchievements`
 * crea y destruye una tabla temporal MEMORY por llamada.
 *
 * ## Qué se tira de GetPlayerStats
 *
 * De los once result sets solo se usan summary, highlights y streaks. Los otros
 * ocho —activity, winRateSeries, perTournament, relegationMatches y compañía—
 * son derivables del historial crudo, que ya va en el dossier UNA vez. Mandarlos
 * por jugador sería pagar treinta veces por el mismo dato.
 *
 * Ese recorte es exclusivo de lo que se pide por jugador. `GetGeneralStats`,
 * `GetTournamentStats` y `GetMundialitoBoard` se llaman una sola vez cada uno y
 * viajan enteros: son la vitrina, los récords, el medallero y la carrera del
 * torneo, es decir el material de las secciones Histórica, Torneo y Mundialito.
 * Quedarse solo con su primer result set —los contadores— dejaría a esas tres
 * secciones sin nada que contar y al diff de mañana sin nada que comparar.
 */
@Injectable()
export class DossierBuilder {
  private readonly logger = new Logger(DossierBuilder.name);

  constructor(private readonly db: DatabaseService) {}

  async build(titularesRecientes: string[]): Promise<Dossier> {
    const historial = await this.historial();
    const jugadores = await this.jugadores();
    // MIN_MATCHES_FOR_RANKING (10) es el MISMO valor que usa el módulo stats.
    // No es negociable: si el diario usara otro, podría proclamar un líder
    // histórico distinto del que muestra la pantalla, y las dos cosas se leen
    // el mismo día. Los jugadores con menos partidos igual están en el dossier
    // por su GetPlayerStats individual; solo no entran a los rankings.
    const general = await this.db.callMulti<Row[][]>('GetGeneralStats', [
      MIN_MATCHES_FOR_RANKING,
    ]);
    const torneoActivo = await this.torneoActivo();
    const mundialito = await this.db.callMulti<Row[][]>('GetMundialitoBoard', []);
    const lore = await this.lore();

    let catalogoLogros: DossierEstado['catalogoLogros'] = [];
    const porJugador: DossierEstado['jugadores'] = {};
    for (const jugador of jugadores) {
      // El orden de la indexación es el contrato con procedures/stats.sql:
      // 1 summary, ... 6 highlights, ... 8 streaks.
      const sets = await this.db.callMulti<Row[][]>('GetPlayerStats', [
        jugador.playerId,
        MIN_AGAINST,
        MIN_TOGETHER,
      ]);
      const logros = await this.db.callMulti<Row[][]>('GetPlayerAchievements', [
        jugador.playerId,
      ]);
      const filasLogros = logros[0] ?? [];

      // El catálogo sale de la PRIMERA llamada a GetPlayerAchievements: las 27
      // devuelven las mismas 30 filas de catálogo y lo único que cambia es el
      // estado. Se llena una sola vez, y con `length === 0` como condición para
      // que un primer jugador sin filas no lo deje vacío para siempre.
      if (catalogoLogros.length === 0) {
        catalogoLogros = filasLogros.map((fila) => ({
          code: String(fila.code),
          title: String(fila.title),
          description: String(fila.description),
          category: String(fila.category),
          isBreakable: Boolean(fila.isBreakable),
        }));
      }

      porJugador[jugador.playerId] = {
        displayName: jugador.displayName,
        summary: sets[0]?.[0] ?? null,
        highlights: sets[5] ?? [],
        streaks: sets[7]?.[0] ?? null,
        // Los 30, con progreso: 'U' obtenido, 'L' bloqueado, 'B' roto, y
        // progress/target es de donde salen los anticipos ("a Tito le faltan
        // dos partidos para el Perro Viejo"). No se filtra por estado ni se
        // tiran las columnas: un logro bloqueado con progreso es una nota.
        logros: filasLogros.map((fila) => ({
          code: String(fila.code),
          state: String(fila.state),
          progress: fila.progress as number | null,
          target: fila.target as number | null,
        })),
      };
    }

    this.logger.log(
      `Dossier armado: ${historial.length} partidos, ${jugadores.length} jugadores`,
    );

    return {
      estado: {
        version: SNAPSHOT_VERSION,
        general,
        torneoActivo,
        mundialito,
        catalogoLogros,
        jugadores: porJugador,
      },
      historial,
      contexto: {
        fecha: new Date().toISOString().slice(0, 10),
        // MAX(matchId), NO el último del historial. El historial viene ordenado
        // por `playedAt, matchId`, y las dos cosas coinciden solo mientras nadie
        // cargue un partido con fecha retroactiva — que `CreateMatch` y
        // `UpdateMatch` permiten sin validar.
        //
        // Si alguna vez `ultimoMatchId < MAX(matchId)`, el guard del cron
        // (`MAX(matchId) != lastMatchId`) queda verdadero PARA SIEMPRE y el
        // diario intenta publicar todos los días sobre material que ya contó.
        ultimoMatchId: await this.maxMatchId(),
        titularesRecientes,
        loreGrupo: lore.grupo,
        lorePorJugador: lore.porJugador,
      },
    };
  }

  /**
   * Todos los partidos, del más viejo al más nuevo.
   *
   * El ORDER BY no es cosmético: es lo que le permite al modelo razonar sobre
   * secuencias —rachas, revanchas, el partido que cortó algo— sin ordenar nada
   * él. El desempate por matchId hace falta porque dos partidos de la misma
   * fecha comparten `playedAt` al minuto.
   *
   * Sale de vMatchDetail y no de un JOIN a mano porque la vista ya arma la
   * convocatoria como JSON y ya resuelve el displayName ("apodo si tiene,
   * nombre completo si no"), que es la regla que hace reconocible a un jugador
   * en el diario. De esa convocatoria acá se conservan dos campos: el resto
   * —foto, nombre y apellido, apodo suelto— triplicaría el historial sin
   * agregarle nada al relato.
   *
   * El JOIN contra Tournaments es por `wasTracked`, que es lo único que la
   * vista no expone y el diario necesita: sin esa columna el modelo no tiene
   * forma de distinguir un partido real de uno sintético, y termina escribiendo
   * la crónica de un partido que nunca se jugó así. Se resuelve con un join a
   * una tabla de cinco filas y NO tocando `vMatchDetail`, que la consume medio
   * sistema: el dossier es el único que necesita el dato.
   */
  private async historial(): Promise<HistorialPartido[]> {
    return this.db.withConnection(async (conn) => {
      const [rows] = await conn.execute<MatchDetailDB[] & RowDataPacket[]>(
        `SELECT v.matchId, v.tournamentId, v.tournamentName, t.wasTracked,
                v.winnerTeam, v.goalsDiference, v.place, v.playedAt, v.isDerby,
                v.players
           FROM vMatchDetail v
           INNER JOIN Tournaments t ON t.tournamentId = v.tournamentId
          ORDER BY v.playedAt, v.matchId`,
      );

      return rows.map((row) => ({
        matchId: row.matchId,
        tournamentId: row.tournamentId,
        tournamentName: row.tournamentName,
        wasTracked: row.wasTracked,
        // La columna es DATETIME y el pool la entrega como Date en UTC. Sale
        // como string con sufijo Z, que es la convención de toda la API.
        playedAt: row.playedAt.toISOString(),
        place: row.place,
        isDerby: row.isDerby,
        winnerTeam: row.winnerTeam,
        goalsDiference: row.goalsDiference,
        equipos: DossierBuilder.equipos(row.players),
      }));
    });
  }

  /** El padrón completo, en el orden en que se recorren los procedures. */
  private async jugadores(): Promise<JugadorDB[]> {
    return this.db.withConnection(async (conn) => {
      // Sin filtro por estado a propósito. Un jugador dado de baja sigue
      // apareciendo en el historial de todos los demás y sus logros se siguen
      // deduciendo; sacarlo del estado haría que el diff de mañana lo lea como
      // "desapareció" en vez de como "no juega más". Son decenas de filas.
      const [rows] = await conn.execute<JugadorDB[] & RowDataPacket[]>(
        `SELECT playerId, displayName
           FROM vPlayerDetail
          ORDER BY playerId`,
      );

      return rows;
    });
  }

  /**
   * El torneo en curso con sus estadísticas, o null si no hay ninguno.
   *
   * Entre temporadas no hay ninguno y eso es lo normal, no un error: el prompt
   * lo tolera y el diario habla de la histórica, los mundialitos y los
   * anticipos. Si hubiera más de uno en 'P' —el estado no lo impide— gana el de
   * `startedAt` más reciente, con el id como desempate para que la elección no
   * dependa del plan del optimizador.
   */
  private async torneoActivo(): Promise<unknown> {
    const enCurso = await this.db.withConnection(async (conn) => {
      const [rows] = await conn.execute<TorneoEnCursoDB[] & RowDataPacket[]>(
        `SELECT tournamentId
           FROM Tournaments
          WHERE state = 'P'
          ORDER BY startedAt DESC, tournamentId DESC
          LIMIT 1`,
      );

      return rows[0] ?? null;
    });

    if (!enCurso) return null;

    return this.db.callMulti<Row[][]>('GetTournamentStats', [enCurso.tournamentId]);
  }

  /**
   * El lore: lo único del dossier que escribió una persona.
   *
   * Son dos SELECT sobre tablas del propio módulo, sin ninguna regla de
   * dominio, así que van por `withConnection` como los del repositorio y no por
   * un procedure nuevo. El del grupo puede no estar cargado —la fila de
   * NewsletterConfig nace con groupLore en NULL— y el de un jugador
   * simplemente no existe hasta que alguien lo escribe: ausente es ausente, no
   * cadena vacía, para que el prompt pueda omitir la sección entera.
   */
  private async lore(): Promise<DossierLore> {
    return this.db.withConnection(async (conn) => {
      const [config] = await conn.execute<GroupLoreDB[] & RowDataPacket[]>(
        `SELECT groupLore FROM NewsletterConfig WHERE configId = 1`,
      );
      const [notas] = await conn.execute<PlayerLoreDB[] & RowDataPacket[]>(
        `SELECT playerId, notes FROM PlayerLore ORDER BY playerId`,
      );

      const porJugador: Record<number, string> = {};
      for (const nota of notas) {
        porJugador[nota.playerId] = nota.notes;
      }

      return { grupo: config[0]?.groupLore ?? null, porJugador };
    });
  }

  /**
   * La marca de agua del diario: el id más alto que existe, no el del último
   * partido del historial.
   *
   * Son dos cosas distintas y la diferencia importa. El historial va ordenado
   * por `playedAt`, así que su último elemento es el partido más RECIENTE, y el
   * id más alto es el último CARGADO. Coinciden mientras nadie use una fecha
   * retroactiva, cosa que `CreateMatch` y `UpdateMatch` aceptan sin chistar.
   *
   * El guard del cron compara este número contra `MAX(matchId)`: si el dossier
   * guardara uno más chico, la comparación daría "hay partidos nuevos" todas
   * las madrugadas para siempre, y el diario gastaría una llamada a la API por
   * día contando material que ya contó.
   */
  private async maxMatchId(): Promise<number> {
    return this.db.withConnection(async (conn) => {
      const [rows] = await conn.execute<MaxMatchIdDB[] & RowDataPacket[]>(
        `SELECT COALESCE(MAX(matchId), 0) AS maxMatchId FROM Matches`,
      );

      return rows[0]?.maxMatchId ?? 0;
    });
  }

  /**
   * Reparte la convocatoria por equipo conservando el orden de la vista, que ya
   * viene agrupada por equipo y alfabética adentro de cada uno.
   */
  private static equipos(
    players: MatchDetailDB['players'],
  ): HistorialPartido['equipos'] {
    const porEquipo = new Map<string, HistorialPartido['equipos'][number]>();

    for (const player of players) {
      const jugador = { playerId: player.playerId, displayName: player.displayName };
      const equipo = porEquipo.get(player.team);

      if (equipo) {
        equipo.jugadores.push(jugador);
      } else {
        porEquipo.set(player.team, { team: player.team, jugadores: [jugador] });
      }
    }

    return [...porEquipo.values()];
  }
}
