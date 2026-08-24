import type { Row } from '../../../database/database.types';
import type { EntityState } from '../../../common/enums/entity-state.enum';
import type { MatchResult } from '../../matches/enums/match-result.enum';
import type { PlayerChampionship } from '../../players/entities/player.entity';
import type { Team } from '../../teams/enums/team.enum';
import type { TournamentState } from '../../tournaments/enums/tournament-state.enum';
import type { StatHighlightKind } from '../enums/stat-highlight-kind.enum';

// ─────────────────────────── GetPlayerStats ──────────────────────────────────
// El orden de estas interfaces ES el orden de los result sets del SP. Ver el
// encabezado de database/procedures/stats.sql.

export interface PlayerStatsSummaryFields {
  playerId: number;
  displayName: string;
  firstName: string;
  secondName: string;
  nickname: string | null;
  photo: string | null;
  state: EntityState;
  isSagrado: boolean;
  createdAt: Date;
  cups: number;
  championships: PlayerChampionship[];
  /** null si todavia no jugo: no esta en la tabla historica. */
  position: number | null;
  tournamentsPlayed: number;
  played: number;
  won: number;
  drew: number;
  lost: number;
  goalsDiference: number;
  points: number;
  maxPoints: number;
  winRate: number | null;
  penalty: number;
  netPoints: number;
  /** Cuantas veces descendio. Viaja en el resumen para la insignia del perfil. */
  relegations: number;
  debutTournamentId: number | null;
  debutTournamentName: string | null;
}

export interface PlayerTournamentStatFields {
  tournamentId: number;
  tournamentName: string;
  tournamentState: TournamentState;
  wasTracked: boolean;
  startedAt: Date;
  position: number;
  played: number;
  won: number;
  drew: number;
  lost: number;
  goalsDiference: number;
  points: number;
  maxPoints: number;
  winRate: number | null;
  penalty: number;
  netPoints: number;
  isChampion: boolean;
}

export interface WinRateSeriesPointFields {
  matchNumber: number;
  matchId: number;
  tournamentId: number;
  tournamentName: string;
  playedAt: Date;
  result: MatchResult;
  goalsDiference: number;
  winRate: number;
}

export interface RivalStatFields {
  playerId: number;
  displayName: string;
  photo: string | null;
  played: number;
  won: number;
  drew: number;
  lost: number;
  balance: number;
  winRate: number;
}

export interface PartnerStatFields {
  playerId: number;
  displayName: string;
  photo: string | null;
  played: number;
  won: number;
  drew: number;
  lost: number;
  winRate: number;
}

export interface StatHighlightFields {
  kind: StatHighlightKind;
  playerId: number;
  displayName: string;
  photo: string | null;
  played: number;
  won: number;
  drew: number;
  lost: number;
  /** null en los destacados de quimica: un companiero no tiene saldo. */
  balance: number | null;
  winRate: number;
}

export interface TeamDistributionFields {
  team: Team;
  isDerbyTeam: boolean;
  played: number;
  won: number;
  drew: number;
  lost: number;
  winRate: number;
}

// ─────────────────────────── GetTournamentStats ───────────────────────────────

export interface TournamentStatsSummaryFields {
  tournamentId: number;
  tournamentName: string;
  state: TournamentState;
  wasTracked: boolean;
  startedAt: Date;
  endedAt: Date;
  matches: number;
  derbies: number;
  draws: number;
  players: number;
  totalGoalsDiference: number;
  avgGoalsDiference: number | null;
  avgPlayersPerMatch: number | null;
  firstMatchAt: Date | null;
  lastMatchAt: Date | null;
  championPlayerId: number | null;
  championName: string | null;
}

export interface TeamPerformanceFields {
  team: Team;
  isDerbyTeam: boolean;
  played: number;
  won: number;
  drew: number;
  lost: number;
  winRate: number;
  goalsDiference: number;
}

export interface HeadToHeadFields {
  teamA: Team;
  teamB: Team;
  isDerby: boolean;
  matches: number;
  winsA: number;
  winsB: number;
  draws: number;
  winRateA: number;
  winRateB: number;
  avgGoalsDiference: number | null;
}

export interface MatchesByPlaceFields {
  place: string;
  matches: number;
  avgGoalsDiference: number | null;
}

export interface MatchTimelinePointFields {
  matchId: number;
  playedAt: Date;
  place: string;
  winnerTeam: Team | null;
  goalsDiference: number;
  isDerby: boolean;
  squadSize: number;
}

// ─────────────────────────── GetGeneralStats ──────────────────────────────────

export interface GeneralStatsSummaryFields {
  players: number;
  activePlayers: number;
  sagradoPlayers: number;
  tournaments: number;
  finishedTournaments: number;
  matches: number;
  derbies: number;
  draws: number;
  totalGoalsDiference: number | null;
  avgGoalsDiference: number | null;
  firstMatchAt: Date | null;
  lastMatchAt: Date | null;
  appearances: number;
  avgPlayersPerMatch: number | null;
}

export interface ChampionRankFields {
  playerId: number;
  displayName: string;
  photo: string | null;
  cups: number;
  championships: PlayerChampionship[];
}

export interface TournamentTimelinePointFields {
  tournamentId: number;
  tournamentName: string;
  startedAt: Date;
  endedAt: Date;
  state: TournamentState;
  wasTracked: boolean;
  matchesCount: number;
  derbiesCount: number;
  playersCount: number;
  championPlayerId: number | null;
  championName: string | null;
}

export interface TopWinRateFields {
  position: number;
  playerId: number;
  displayName: string;
  photo: string | null;
  cups: number;
  played: number;
  won: number;
  drew: number;
  lost: number;
  winRate: number | null;
  netPoints: number;
}

export interface RecordsFields {
  biggestWinMargin: number | null;
  biggestWinMatchId: number | null;
  biggestSquad: number | null;
  mostMatchesPlayed: number | null;
  mostCups: number | null;
}

/** Rachas de un jugador. Las fechas llegan como ISO con Z desde la vista. */
export interface PlayerStreaksFields {
  playerId: number;
  bestUnbeaten: number;
  bestUnbeatenEndedAt: string | null;
  bestWin: number;
  bestWinEndedAt: string | null;
  worstWinless: number;
  /** Racha invicta abierta. Puede convivir con la de abajo tras un empate. */
  currentUnbeaten: number;
  currentWinless: number;
}

/** Un partido del grupo visto desde un jugador. `result` null = no jugo. */
export interface PlayerActivityFields {
  matchId: number;
  tournamentId: number;
  tournamentName: string;
  playedAt: Date;
  result: MatchResult | null;
  team: Team | null;
}

/** Un punto de la serie: la fecha, los puntos acumulados y como le fue. */
export interface RaceSeriesPoint {
  /** Numero de fecha dentro del torneo, empezando en 1. */
  n: number;
  /** Puntos acumulados hasta esa fecha. */
  p: number;
  /** null cuando no jugo esa fecha: la linea queda horizontal. */
  r: MatchResult | null;
}

/**
 * La linea de un jugador en la carrera del campeonato.
 *
 * La serie viaja como JSON y no como una fila por fecha: son veintisiete
 * jugadores por veinticuatro fechas, y mandar 648 filas para dibujar
 * veintisiete lineas es pagar el ancho de banda de una tabla.
 */
export interface TournamentRaceEntryFields {
  playerId: number;
  displayName: string;
  /** Posicion final en la tabla. */
  position: number;
  /** 1 si va en color; el resto se dibuja en gris como contexto. */
  highlight: number;
  /** 1 si estuvo primero en algun momento del torneo. */
  everLed: number;
  total: number;
  series: RaceSeriesPoint[];
}

/** Asistencia de un jugador al torneo, como lista de partidos jugados. */
export interface TournamentAttendanceFields {
  playerId: number;
  displayName: string;
  photo: string | null;
  played: number;
  matches: number[];
}

/** Una racha invicta historica, con protagonista. */
export interface StreakRecordFields {
  playerId: number;
  displayName: string;
  photo: string | null;
  length: number;
  startedAt: Date;
  endedAt: Date;
  /** 1 si sigue viva. */
  isOpen: number;
}

/** Una fila de la tabla de descensos: quien bajo y cuantas veces. */
export interface RelegationRankFields {
  playerId: number;
  displayName: string;
  photo: string | null;
  relegations: number;
  /** De esos descensos, cuantos fueron con los ocho partidos perdidos. */
  allLossRelegations: number;
  firstRelegationAt: Date;
  lastRelegationAt: Date;
}

/**
 * Una carrera al descenso: el bloque de ocho partidos sin ganar dentro de un
 * tramo. `matches` llega a 8 en las consumadas y se queda corto en las demas.
 */
export interface RelegationRunFields {
  /** Cronologico dentro del jugador, desde 1. Correlaciona con los partidos. */
  runIndex: number;
  /** El contador del descenso: partidos sin ganar, de 1 a 8. */
  matches: number;
  losses: number;
  draws: number;
  startedAt: Date;
  /** El octavo partido. null si la carrera no llego a descenso. */
  endedAt: Date | null;
  /** 1 si llego a los ocho. */
  isRelegated: number;
  /** 1 si descendio sin un solo empate: los ocho perdidos. */
  isAllLosses: number;
  /** 1 si el tramo sigue vivo y la carrera todavia puede consumarse. */
  isOpen: number;
}

/** Un partido de una carrera. El empate cuenta igual que la derrota. */
export interface RelegationRunMatchFields {
  runIndex: number;
  matchId: number;
  tournamentId: number;
  tournamentName: string;
  playedAt: Date;
  result: MatchResult;
  /** Con signo desde su punto de vista. Solo para el detalle del partido. */
  goalsDiference: number;
  team: Team;
  /** Su casilla en la carrera, de 1 a 8. La octava es la que la consuma. */
  posInRace: number;
}

// ─────────────────────────── Filas crudas ─────────────────────────────────────

export interface PlayerStatsSummaryDB extends Row, PlayerStatsSummaryFields {}
export interface PlayerTournamentStatDB extends Row, PlayerTournamentStatFields {}
export interface WinRateSeriesPointDB extends Row, WinRateSeriesPointFields {}
export interface RivalStatDB extends Row, RivalStatFields {}
export interface PartnerStatDB extends Row, PartnerStatFields {}
export interface StatHighlightDB extends Row, StatHighlightFields {}
export interface TeamDistributionDB extends Row, TeamDistributionFields {}
export interface TournamentStatsSummaryDB extends Row, TournamentStatsSummaryFields {}
export interface TeamPerformanceDB extends Row, TeamPerformanceFields {}
export interface HeadToHeadDB extends Row, HeadToHeadFields {}
export interface MatchesByPlaceDB extends Row, MatchesByPlaceFields {}
export interface MatchTimelinePointDB extends Row, MatchTimelinePointFields {}
export interface GeneralStatsSummaryDB extends Row, GeneralStatsSummaryFields {}
export interface ChampionRankDB extends Row, ChampionRankFields {}
export interface TournamentTimelinePointDB extends Row, TournamentTimelinePointFields {}
export interface TopWinRateDB extends Row, TopWinRateFields {}
export interface RecordsDB extends Row, RecordsFields {}
export interface PlayerStreaksDB extends Row, PlayerStreaksFields {}
export interface PlayerActivityDB extends Row, PlayerActivityFields {}
export interface TournamentRaceEntryDB extends Row, TournamentRaceEntryFields {}
export interface TournamentAttendanceDB extends Row, TournamentAttendanceFields {}
export interface StreakRecordDB extends Row, StreakRecordFields {}
export interface RelegationRankDB extends Row, RelegationRankFields {}
export interface RelegationRunDB extends Row, RelegationRunFields {}
export interface RelegationRunMatchDB extends Row, RelegationRunMatchFields {}
