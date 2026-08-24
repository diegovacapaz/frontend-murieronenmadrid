import type { Row } from '../../../database/database.types';
import type {
  ChampionRankDB,
  ChampionRankFields,
  GeneralStatsSummaryDB,
  GeneralStatsSummaryFields,
  HeadToHeadDB,
  HeadToHeadFields,
  MatchTimelinePointDB,
  MatchTimelinePointFields,
  MatchesByPlaceDB,
  MatchesByPlaceFields,
  PartnerStatDB,
  PartnerStatFields,
  PlayerActivityDB,
  PlayerActivityFields,
  PlayerStatsSummaryDB,
  PlayerStatsSummaryFields,
  PlayerStreaksDB,
  PlayerStreaksFields,
  RaceSeriesPoint,
  PlayerTournamentStatDB,
  PlayerTournamentStatFields,
  RecordsDB,
  RecordsFields,
  RivalStatDB,
  RivalStatFields,
  StatHighlightDB,
  StatHighlightFields,
  RelegationRankDB,
  RelegationRankFields,
  RelegationRunDB,
  RelegationRunFields,
  RelegationRunMatchDB,
  RelegationRunMatchFields,
  StreakRecordDB,
  StreakRecordFields,
  TeamDistributionDB,
  TeamDistributionFields,
  TeamPerformanceDB,
  TeamPerformanceFields,
  TopWinRateDB,
  TopWinRateFields,
  TournamentAttendanceDB,
  TournamentAttendanceFields,
  TournamentRaceEntryDB,
  TournamentRaceEntryFields,
  TournamentStatsSummaryDB,
  TournamentStatsSummaryFields,
  TournamentTimelinePointDB,
  TournamentTimelinePointFields,
  WinRateSeriesPointDB,
  WinRateSeriesPointFields,
} from '../interfaces/database';

/**
 * Copia de una fila solo las columnas declaradas, devolviendo un objeto plano.
 *
 * Las estadisticas son proyecciones de lectura: no tienen comportamiento de
 * dominio, y su shape de BD y su shape de respuesta son el mismo por
 * construccion. Escribir 25 mappers campo por campo seria ruido sin valor.
 *
 * Pero tampoco se devuelve la fila cruda: un RowDataPacket arrastra las
 * columnas que el SP agregue mañana y las filtraria recien en el JSON, si es
 * que las filtra. Con la lista explicita de claves —tipada contra la interfaz,
 * asi un typo no compila— el contrato de la API queda escrito en el codigo.
 */
function project<T extends object>(row: Row & T, keys: ReadonlyArray<keyof T>): T {
  const result = {} as T;
  for (const key of keys) {
    result[key] = row[key];
  }
  return result;
}

function projectList<T extends object>(
  rows: Array<Row & T>,
  keys: ReadonlyArray<keyof T>,
): T[] {
  return rows.map((row) => project(row, keys));
}

const PLAYER_SUMMARY_KEYS = [
  'playerId', 'displayName', 'firstName', 'secondName', 'nickname', 'photo',
  'state', 'isSagrado', 'createdAt', 'cups', 'championships', 'position',
  'tournamentsPlayed', 'played', 'won', 'drew', 'lost', 'goalsDiference',
  'points', 'maxPoints', 'winRate', 'penalty', 'netPoints', 'relegations',
  'debutTournamentId', 'debutTournamentName',
] as const satisfies ReadonlyArray<keyof PlayerStatsSummaryFields>;

const PLAYER_TOURNAMENT_KEYS = [
  'tournamentId', 'tournamentName', 'tournamentState', 'wasTracked', 'startedAt',
  'position', 'played', 'won', 'drew', 'lost', 'goalsDiference', 'points',
  'maxPoints', 'winRate', 'penalty', 'netPoints', 'isChampion',
] as const satisfies ReadonlyArray<keyof PlayerTournamentStatFields>;

const WINRATE_POINT_KEYS = [
  'matchNumber', 'matchId', 'tournamentId', 'tournamentName', 'playedAt',
  'result', 'goalsDiference', 'winRate',
] as const satisfies ReadonlyArray<keyof WinRateSeriesPointFields>;

const RIVAL_KEYS = [
  'playerId', 'displayName', 'photo', 'played', 'won', 'drew', 'lost',
  'balance', 'winRate',
] as const satisfies ReadonlyArray<keyof RivalStatFields>;

const PARTNER_KEYS = [
  'playerId', 'displayName', 'photo', 'played', 'won', 'drew', 'lost', 'winRate',
] as const satisfies ReadonlyArray<keyof PartnerStatFields>;

const HIGHLIGHT_KEYS = [
  'kind', 'playerId', 'displayName', 'photo', 'played', 'won', 'drew', 'lost',
  'balance', 'winRate',
] as const satisfies ReadonlyArray<keyof StatHighlightFields>;

const TEAM_DISTRIBUTION_KEYS = [
  'team', 'isDerbyTeam', 'played', 'won', 'drew', 'lost', 'winRate',
] as const satisfies ReadonlyArray<keyof TeamDistributionFields>;

const TOURNAMENT_SUMMARY_KEYS = [
  'tournamentId', 'tournamentName', 'state', 'wasTracked', 'startedAt', 'endedAt',
  'matches', 'derbies', 'draws', 'players', 'totalGoalsDiference',
  'avgGoalsDiference', 'avgPlayersPerMatch', 'firstMatchAt', 'lastMatchAt',
  'championPlayerId', 'championName',
] as const satisfies ReadonlyArray<keyof TournamentStatsSummaryFields>;

const TEAM_PERFORMANCE_KEYS = [
  'team', 'isDerbyTeam', 'played', 'won', 'drew', 'lost', 'winRate',
  'goalsDiference',
] as const satisfies ReadonlyArray<keyof TeamPerformanceFields>;

const HEAD_TO_HEAD_KEYS = [
  'teamA', 'teamB', 'isDerby', 'matches', 'winsA', 'winsB', 'draws',
  'winRateA', 'winRateB', 'avgGoalsDiference',
] as const satisfies ReadonlyArray<keyof HeadToHeadFields>;

const MATCHES_BY_PLACE_KEYS = [
  'place', 'matches', 'avgGoalsDiference',
] as const satisfies ReadonlyArray<keyof MatchesByPlaceFields>;

const MATCH_TIMELINE_KEYS = [
  'matchId', 'playedAt', 'place', 'winnerTeam', 'goalsDiference', 'isDerby',
  'squadSize',
] as const satisfies ReadonlyArray<keyof MatchTimelinePointFields>;

const GENERAL_SUMMARY_KEYS = [
  'players', 'activePlayers', 'sagradoPlayers', 'tournaments',
  'finishedTournaments', 'matches', 'derbies', 'draws', 'totalGoalsDiference',
  'avgGoalsDiference', 'firstMatchAt', 'lastMatchAt', 'appearances',
  'avgPlayersPerMatch',
] as const satisfies ReadonlyArray<keyof GeneralStatsSummaryFields>;

const CHAMPION_RANK_KEYS = [
  'playerId', 'displayName', 'photo', 'cups', 'championships',
] as const satisfies ReadonlyArray<keyof ChampionRankFields>;

const TOURNAMENT_TIMELINE_KEYS = [
  'tournamentId', 'tournamentName', 'startedAt', 'endedAt', 'state',
  'wasTracked', 'matchesCount', 'derbiesCount', 'playersCount',
  'championPlayerId', 'championName',
] as const satisfies ReadonlyArray<keyof TournamentTimelinePointFields>;

const TOP_WINRATE_KEYS = [
  'position', 'playerId', 'displayName', 'photo', 'cups', 'played', 'won',
  'drew', 'lost', 'winRate', 'netPoints',
] as const satisfies ReadonlyArray<keyof TopWinRateFields>;

const RECORDS_KEYS = [
  'biggestWinMargin', 'biggestWinMatchId', 'biggestSquad', 'mostMatchesPlayed',
  'mostCups',
] as const satisfies ReadonlyArray<keyof RecordsFields>;

const PLAYER_STREAKS_KEYS = [
  'playerId', 'bestUnbeaten', 'bestUnbeatenEndedAt', 'bestWin', 'bestWinEndedAt',
  'worstWinless', 'currentUnbeaten', 'currentWinless',
] as const satisfies ReadonlyArray<keyof PlayerStreaksFields>;

const PLAYER_ACTIVITY_KEYS = [
  'matchId', 'tournamentId', 'tournamentName', 'playedAt', 'result', 'team',
] as const satisfies ReadonlyArray<keyof PlayerActivityFields>;

const RACE_ENTRY_KEYS = [
  'playerId', 'displayName', 'position', 'highlight', 'everLed', 'total', 'series',
] as const satisfies ReadonlyArray<keyof TournamentRaceEntryFields>;

const ATTENDANCE_KEYS = [
  'playerId', 'displayName', 'photo', 'played', 'matches',
] as const satisfies ReadonlyArray<keyof TournamentAttendanceFields>;

const STREAK_RECORD_KEYS = [
  'playerId', 'displayName', 'photo', 'length', 'startedAt', 'endedAt', 'isOpen',
] as const satisfies ReadonlyArray<keyof StreakRecordFields>;

const RELEGATION_RANK_KEYS = [
  'playerId', 'displayName', 'photo', 'relegations', 'allLossRelegations',
  'firstRelegationAt', 'lastRelegationAt',
] as const satisfies ReadonlyArray<keyof RelegationRankFields>;

const RELEGATION_RUN_KEYS = [
  'runIndex', 'matches', 'losses', 'draws', 'startedAt', 'endedAt',
  'isRelegated', 'isAllLosses', 'isOpen',
] as const satisfies ReadonlyArray<keyof RelegationRunFields>;

const RELEGATION_RUN_MATCH_KEYS = [
  'runIndex', 'matchId', 'tournamentId', 'tournamentName',
  'playedAt', 'result', 'goalsDiference', 'team', 'posInRace',
] as const satisfies ReadonlyArray<keyof RelegationRunMatchFields>;

export class StatsFactory {
  static playerSummary(db: PlayerStatsSummaryDB): PlayerStatsSummaryFields {
    const summary = project(db, PLAYER_SUMMARY_KEYS);
    summary.championships = db.championships ?? [];
    return summary;
  }

  static playerTournaments(dbs: PlayerTournamentStatDB[]): PlayerTournamentStatFields[] {
    return projectList(dbs, PLAYER_TOURNAMENT_KEYS).map((row) => ({
      ...row,
      // isChampion no es una columna sino una comparacion del SP, y MySQL la
      // devuelve como entero 0/1: el typeCast del pool solo convierte a boolean
      // los TINYINT(1) reales. Sin esta coercion el DTO dice `boolean` y viaja
      // un numero — una mentira de tipo que del otro lado hace que un
      // `{isChampion && <Icono/>}` pinte un "0" en pantalla.
      isChampion: Boolean(row.isChampion),
    }));
  }

  static winRateSeries(dbs: WinRateSeriesPointDB[]): WinRateSeriesPointFields[] {
    return projectList(dbs, WINRATE_POINT_KEYS);
  }

  static rivals(dbs: RivalStatDB[]): RivalStatFields[] {
    return projectList(dbs, RIVAL_KEYS);
  }

  static partners(dbs: PartnerStatDB[]): PartnerStatFields[] {
    return projectList(dbs, PARTNER_KEYS);
  }

  static highlights(dbs: StatHighlightDB[]): StatHighlightFields[] {
    return projectList(dbs, HIGHLIGHT_KEYS);
  }

  static teamDistribution(dbs: TeamDistributionDB[]): TeamDistributionFields[] {
    return projectList(dbs, TEAM_DISTRIBUTION_KEYS);
  }

  static tournamentSummary(db: TournamentStatsSummaryDB): TournamentStatsSummaryFields {
    return project(db, TOURNAMENT_SUMMARY_KEYS);
  }

  static teamPerformance(dbs: TeamPerformanceDB[]): TeamPerformanceFields[] {
    return projectList(dbs, TEAM_PERFORMANCE_KEYS);
  }

  static headToHead(dbs: HeadToHeadDB[]): HeadToHeadFields[] {
    return projectList(dbs, HEAD_TO_HEAD_KEYS);
  }

  static matchesByPlace(dbs: MatchesByPlaceDB[]): MatchesByPlaceFields[] {
    return projectList(dbs, MATCHES_BY_PLACE_KEYS);
  }

  static matchTimeline(dbs: MatchTimelinePointDB[]): MatchTimelinePointFields[] {
    return projectList(dbs, MATCH_TIMELINE_KEYS);
  }

  static generalSummary(db: GeneralStatsSummaryDB): GeneralStatsSummaryFields {
    return project(db, GENERAL_SUMMARY_KEYS);
  }

  static championsRanking(dbs: ChampionRankDB[]): ChampionRankFields[] {
    return projectList(dbs, CHAMPION_RANK_KEYS).map((champion) => ({
      ...champion,
      championships: champion.championships ?? [],
    }));
  }

  static tournamentsTimeline(
    dbs: TournamentTimelinePointDB[],
  ): TournamentTimelinePointFields[] {
    return projectList(dbs, TOURNAMENT_TIMELINE_KEYS);
  }

  static topWinRate(dbs: TopWinRateDB[]): TopWinRateFields[] {
    return projectList(dbs, TOP_WINRATE_KEYS);
  }

  static playerStreaks(db: PlayerStreaksDB): PlayerStreaksFields {
    return project(db, PLAYER_STREAKS_KEYS);
  }

  static playerActivity(dbs: PlayerActivityDB[]): PlayerActivityFields[] {
    return projectList(dbs, PLAYER_ACTIVITY_KEYS);
  }

  static race(dbs: TournamentRaceEntryDB[]): TournamentRaceEntryFields[] {
    return dbs.map((db) => {
      const row = project(db, RACE_ENTRY_KEYS);
      // JSON_ARRAYAGG no garantiza el orden de sus elementos: se ordena aca en
      // vez de confiar en un detalle de implementacion del motor.
      const series: RaceSeriesPoint[] = db.series ?? [];
      row.series = [...series].sort((a, b) => a.n - b.n);
      return row;
    });
  }

  static attendance(dbs: TournamentAttendanceDB[]): TournamentAttendanceFields[] {
    return dbs.map((db) => {
      const row = project(db, ATTENDANCE_KEYS);
      // El JSON_ARRAYAGG llega parseado por el typeCast, pero una fila sin
      // partidos no existe en el result set; el ?? es por las dudas.
      row.matches = db.matches ?? [];
      return row;
    });
  }

  static streakRecords(dbs: StreakRecordDB[]): StreakRecordFields[] {
    return projectList(dbs, STREAK_RECORD_KEYS);
  }

  static relegations(dbs: RelegationRankDB[]): RelegationRankFields[] {
    return projectList(dbs, RELEGATION_RANK_KEYS);
  }

  static relegationRuns(dbs: RelegationRunDB[]): RelegationRunFields[] {
    return projectList(dbs, RELEGATION_RUN_KEYS);
  }

  static relegationMatches(dbs: RelegationRunMatchDB[]): RelegationRunMatchFields[] {
    return projectList(dbs, RELEGATION_RUN_MATCH_KEYS);
  }

  static records(db: RecordsDB): RecordsFields {
    return project(db, RECORDS_KEYS);
  }
}
