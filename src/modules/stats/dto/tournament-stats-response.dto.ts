import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Team } from '../../teams/enums/team.enum';
import { TournamentState } from '../../tournaments/enums/tournament-state.enum';

export class TournamentStatsSummaryDto {
  @ApiProperty() tournamentId!: number;
  @ApiProperty() tournamentName!: string;
  @ApiProperty({ enum: TournamentState }) state!: TournamentState;
  @ApiProperty() wasTracked!: boolean;
  @ApiProperty() startedAt!: Date;
  @ApiProperty() endedAt!: Date;
  @ApiProperty() matches!: number;
  @ApiProperty() derbies!: number;
  @ApiProperty() draws!: number;
  @ApiProperty({ description: 'Jugadores distintos que participaron.' })
  players!: number;
  @ApiProperty() totalGoalsDiference!: number;
  @ApiPropertyOptional({ nullable: true }) avgGoalsDiference!: number | null;
  @ApiPropertyOptional({ nullable: true }) avgPlayersPerMatch!: number | null;
  @ApiPropertyOptional({ nullable: true }) firstMatchAt!: Date | null;
  @ApiPropertyOptional({ nullable: true }) lastMatchAt!: Date | null;
  @ApiPropertyOptional({ nullable: true }) championPlayerId!: number | null;
  @ApiPropertyOptional({ nullable: true }) championName!: string | null;
}

export class TeamPerformanceDto {
  @ApiProperty({ enum: Team }) team!: Team;
  @ApiProperty() isDerbyTeam!: boolean;
  @ApiProperty({ description: 'Partidos en los que ese equipo tuvo convocados.' })
  played!: number;
  @ApiProperty() won!: number;
  @ApiProperty() drew!: number;
  @ApiProperty() lost!: number;
  @ApiProperty() winRate!: number;
  @ApiProperty({ description: 'Diferencia de gol acumulada del equipo.' })
  goalsDiference!: number;
}

export class HeadToHeadDto {
  @ApiProperty({ enum: Team }) teamA!: Team;
  @ApiProperty({ enum: Team }) teamB!: Team;
  @ApiProperty({ description: 'Separa derbies de partidos comunes.' })
  isDerby!: boolean;
  @ApiProperty() matches!: number;
  @ApiProperty() winsA!: number;
  @ApiProperty() winsB!: number;
  @ApiProperty() draws!: number;
  @ApiProperty() winRateA!: number;
  @ApiProperty() winRateB!: number;
  @ApiPropertyOptional({ nullable: true }) avgGoalsDiference!: number | null;
}

export class MatchesByPlaceDto {
  @ApiProperty() place!: string;
  @ApiProperty() matches!: number;
  @ApiPropertyOptional({ nullable: true }) avgGoalsDiference!: number | null;
}

export class MatchTimelinePointDto {
  @ApiProperty() matchId!: number;
  @ApiProperty() playedAt!: Date;
  @ApiProperty() place!: string;
  @ApiPropertyOptional({ enum: Team, nullable: true }) winnerTeam!: Team | null;
  @ApiProperty() goalsDiference!: number;
  @ApiProperty() isDerby!: boolean;
  @ApiProperty({ description: 'Cuanta gente jugo ese partido.' })
  squadSize!: number;
}

export class TournamentStatsResponseDto {
  @ApiProperty({ type: TournamentStatsSummaryDto })
  summary!: TournamentStatsSummaryDto;

  @ApiProperty({ type: [TeamPerformanceDto] })
  teamPerformance!: TeamPerformanceDto[];

  @ApiProperty({
    type: [HeadToHeadDto],
    description: 'Winrate de un equipo frente a otro, separando derbies.',
  })
  headToHead!: HeadToHeadDto[];

  @ApiProperty({ type: [MatchesByPlaceDto] })
  matchesByPlace!: MatchesByPlaceDto[];

  @ApiProperty({ type: [MatchTimelinePointDto] })
  timeline!: MatchTimelinePointDto[];
}
