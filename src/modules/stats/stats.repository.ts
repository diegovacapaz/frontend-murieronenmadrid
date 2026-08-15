import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { StatsFactory } from './helpers/stats.factory';
import {
  ChampionRankDB,
  GeneralStatsSummaryDB,
  HeadToHeadDB,
  MatchTimelinePointDB,
  MatchesByPlaceDB,
  PartnerStatDB,
  PlayerStatsSummaryDB,
  PlayerTournamentStatDB,
  RecordsDB,
  RivalStatDB,
  StatHighlightDB,
  TeamDistributionDB,
  TeamPerformanceDB,
  TopWinRateDB,
  TournamentStatsSummaryDB,
  TournamentTimelinePointDB,
  WinRateSeriesPointDB,
} from './interfaces/database';
import {
  GeneralStats,
  IStatsRepository,
  PlayerStats,
  TournamentStats,
} from './interfaces/stats.repository.interface';

/**
 * Cada metodo hace UNA llamada a la base y desarma los N result sets que
 * devuelve el SP. Es la razon de ser de callMulti: un perfil completo son siete
 * agregados distintos y pedirlos con siete queries seria siete veces el
 * round-trip para datos que se calculan de una pasada.
 *
 * El orden de la desestructuracion es el contrato con stats.sql. Esta
 * documentado en el encabezado de ese archivo y en cada SP.
 */
@Injectable()
export class StatsRepository implements IStatsRepository {
  constructor(private readonly db: DatabaseService) {}

  async findPlayerStats(
    playerId: number,
    minAgainst: number,
    minTogether: number,
  ): Promise<PlayerStats> {
    const [
      summary,
      perTournament,
      winRateSeries,
      rivals,
      partners,
      highlights,
      teamDistribution,
    ] = await this.db.callMulti<
      [
        PlayerStatsSummaryDB[],
        PlayerTournamentStatDB[],
        WinRateSeriesPointDB[],
        RivalStatDB[],
        PartnerStatDB[],
        StatHighlightDB[],
        TeamDistributionDB[],
      ]
    >('GetPlayerStats', [playerId, minAgainst, minTogether]);

    return {
      summary: StatsFactory.playerSummary(this.firstOrFail(summary, 'GetPlayerStats')),
      perTournament: StatsFactory.playerTournaments(perTournament),
      winRateSeries: StatsFactory.winRateSeries(winRateSeries),
      rivals: StatsFactory.rivals(rivals),
      partners: StatsFactory.partners(partners),
      highlights: StatsFactory.highlights(highlights),
      teamDistribution: StatsFactory.teamDistribution(teamDistribution),
    };
  }

  async findTournamentStats(tournamentId: number): Promise<TournamentStats> {
    const [summary, teamPerformance, headToHead, matchesByPlace, timeline] =
      await this.db.callMulti<
        [
          TournamentStatsSummaryDB[],
          TeamPerformanceDB[],
          HeadToHeadDB[],
          MatchesByPlaceDB[],
          MatchTimelinePointDB[],
        ]
      >('GetTournamentStats', [tournamentId]);

    return {
      summary: StatsFactory.tournamentSummary(
        this.firstOrFail(summary, 'GetTournamentStats'),
      ),
      teamPerformance: StatsFactory.teamPerformance(teamPerformance),
      headToHead: StatsFactory.headToHead(headToHead),
      matchesByPlace: StatsFactory.matchesByPlace(matchesByPlace),
      timeline: StatsFactory.matchTimeline(timeline),
    };
  }

  async findGeneralStats(minMatches: number): Promise<GeneralStats> {
    const [
      summary,
      headToHead,
      championsRanking,
      tournamentsTimeline,
      topWinRate,
      records,
    ] = await this.db.callMulti<
      [
        GeneralStatsSummaryDB[],
        HeadToHeadDB[],
        ChampionRankDB[],
        TournamentTimelinePointDB[],
        TopWinRateDB[],
        RecordsDB[],
      ]
    >('GetGeneralStats', [minMatches]);

    return {
      summary: StatsFactory.generalSummary(this.firstOrFail(summary, 'GetGeneralStats')),
      headToHead: StatsFactory.headToHead(headToHead),
      championsRanking: StatsFactory.championsRanking(championsRanking),
      tournamentsTimeline: StatsFactory.tournamentsTimeline(tournamentsTimeline),
      topWinRate: StatsFactory.topWinRate(topWinRate),
      records: StatsFactory.records(this.firstOrFail(records, 'GetGeneralStats')),
    };
  }

  /**
   * Los result sets de resumen devuelven siempre exactamente una fila (son
   * agregados sin GROUP BY). Que venga vacio significa que el SP cambio y el
   * contrato se rompio: es un 500, no un dato ausente.
   */
  private firstOrFail<T>(rows: T[], sp: string): T {
    const first = rows?.[0];
    if (!first) {
      throw new InternalServerErrorException(`SP ${sp} devolvio un resumen vacio`);
    }
    return first;
  }
}
