import type {
  ChampionRankFields,
  GeneralStatsSummaryFields,
  HeadToHeadFields,
  MatchTimelinePointFields,
  MatchesByPlaceFields,
  PartnerStatFields,
  PlayerStatsSummaryFields,
  PlayerTournamentStatFields,
  RecordsFields,
  RivalStatFields,
  StatHighlightFields,
  TeamDistributionFields,
  TeamPerformanceFields,
  TopWinRateFields,
  TournamentStatsSummaryFields,
  TournamentTimelinePointFields,
} from './database';

/**
 * Lo que devuelve GetPlayerStats, con sus siete result sets ya nombrados.
 *
 * El SP los emite en orden y el repository los desestructura; a partir de aca
 * nadie depende de ese orden. Si mañana se agrega uno nuevo, va al final del SP
 * y suma una propiedad aca: los consumidores existentes no se enteran.
 */
export interface PlayerStats {
  summary: PlayerStatsSummaryFields;
  perTournament: PlayerTournamentStatFields[];
  winRateSeries: import('./database').WinRateSeriesPointFields[];
  rivals: RivalStatFields[];
  partners: PartnerStatFields[];
  highlights: StatHighlightFields[];
  teamDistribution: TeamDistributionFields[];
  streaks: import('./database').PlayerStreaksFields;
  activity: import('./database').PlayerActivityFields[];
}

export interface TournamentStats {
  summary: TournamentStatsSummaryFields;
  teamPerformance: TeamPerformanceFields[];
  headToHead: HeadToHeadFields[];
  matchesByPlace: MatchesByPlaceFields[];
  timeline: MatchTimelinePointFields[];
  race: import('./database').TournamentRaceEntryFields[];
  attendance: import('./database').TournamentAttendanceFields[];
}

export interface GeneralStats {
  summary: GeneralStatsSummaryFields;
  headToHead: HeadToHeadFields[];
  championsRanking: ChampionRankFields[];
  tournamentsTimeline: TournamentTimelinePointFields[];
  topWinRate: TopWinRateFields[];
  records: RecordsFields;
  streakRecords: import('./database').StreakRecordFields[];
}

export interface IStatsRepository {
  findPlayerStats(
    playerId: number,
    minAgainst: number,
    minTogether: number,
  ): Promise<PlayerStats>;
  findTournamentStats(tournamentId: number): Promise<TournamentStats>;
  findGeneralStats(minMatches: number): Promise<GeneralStats>;
}
