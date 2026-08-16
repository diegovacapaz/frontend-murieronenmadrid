import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PlayerChampionshipDto } from '../../players/dto/player-response.dto';
import { TournamentState } from '../../tournaments/enums/tournament-state.enum';
import { HeadToHeadDto } from './tournament-stats-response.dto';

export class GeneralStatsSummaryDto {
  @ApiProperty() players!: number;
  @ApiProperty() activePlayers!: number;
  @ApiProperty() sagradoPlayers!: number;
  @ApiProperty() tournaments!: number;
  @ApiProperty() finishedTournaments!: number;
  @ApiProperty() matches!: number;
  @ApiProperty() derbies!: number;
  @ApiProperty() draws!: number;
  @ApiPropertyOptional({ nullable: true }) totalGoalsDiference!: number | null;
  @ApiPropertyOptional({ nullable: true }) avgGoalsDiference!: number | null;
  @ApiPropertyOptional({ nullable: true }) firstMatchAt!: Date | null;
  @ApiPropertyOptional({ nullable: true }) lastMatchAt!: Date | null;
  @ApiProperty({ description: 'Suma de participaciones (jugador x partido).' })
  appearances!: number;
  @ApiPropertyOptional({ nullable: true }) avgPlayersPerMatch!: number | null;
}

export class ChampionRankDto {
  @ApiProperty() playerId!: number;
  @ApiProperty() displayName!: string;
  @ApiPropertyOptional({ nullable: true }) photo!: string | null;
  @ApiProperty() cups!: number;
  @ApiProperty({ type: [PlayerChampionshipDto] })
  championships!: PlayerChampionshipDto[];
}

export class TournamentTimelinePointDto {
  @ApiProperty() tournamentId!: number;
  @ApiProperty() tournamentName!: string;
  @ApiProperty() startedAt!: Date;
  @ApiProperty() endedAt!: Date;
  @ApiProperty({ enum: TournamentState }) state!: TournamentState;
  @ApiProperty() wasTracked!: boolean;
  @ApiProperty() matchesCount!: number;
  @ApiProperty() derbiesCount!: number;
  @ApiProperty() playersCount!: number;
  @ApiPropertyOptional({ nullable: true }) championPlayerId!: number | null;
  @ApiPropertyOptional({ nullable: true }) championName!: string | null;
}

export class TopWinRateDto {
  @ApiProperty({ description: 'Posicion en la tabla historica, no en este ranking.' })
  position!: number;
  @ApiProperty() playerId!: number;
  @ApiProperty() displayName!: string;
  @ApiPropertyOptional({ nullable: true }) photo!: string | null;
  @ApiProperty() cups!: number;
  @ApiProperty() played!: number;
  @ApiProperty() won!: number;
  @ApiProperty() drew!: number;
  @ApiProperty() lost!: number;
  @ApiPropertyOptional({ nullable: true }) winRate!: number | null;
  @ApiProperty() netPoints!: number;
}

export class RecordsDto {
  @ApiPropertyOptional({ nullable: true, description: 'La goleada mas grande.' })
  biggestWinMargin!: number | null;
  @ApiPropertyOptional({ nullable: true }) biggestWinMatchId!: number | null;
  @ApiPropertyOptional({ nullable: true, description: 'El partido con mas gente.' })
  biggestSquad!: number | null;
  @ApiPropertyOptional({ nullable: true }) mostMatchesPlayed!: number | null;
  @ApiPropertyOptional({ nullable: true }) mostCups!: number | null;
}

export class StreakRecordDto {
  @ApiProperty()
  playerId!: number;

  @ApiProperty()
  displayName!: string;

  @ApiPropertyOptional({ nullable: true })
  photo!: string | null;

  @ApiProperty({ description: 'Partidos seguidos sin perder.' })
  length!: number;

  @ApiProperty()
  startedAt!: Date;

  @ApiProperty()
  endedAt!: Date;

  @ApiProperty({ description: '1 si la racha sigue viva.' })
  isOpen!: number;
}

export class GeneralStatsResponseDto {
  @ApiProperty({ type: GeneralStatsSummaryDto })
  summary!: GeneralStatsSummaryDto;

  @ApiProperty({ type: [HeadToHeadDto] })
  headToHead!: HeadToHeadDto[];

  @ApiProperty({ type: [ChampionRankDto], description: 'La vitrina del grupo.' })
  championsRanking!: ChampionRankDto[];

  @ApiProperty({ type: [TournamentTimelinePointDto] })
  tournamentsTimeline!: TournamentTimelinePointDto[];

  @ApiProperty({ type: [TopWinRateDto] })
  topWinRate!: TopWinRateDto[];

  @ApiProperty({ type: RecordsDto })
  records!: RecordsDto;

  @ApiProperty({
    type: [StreakRecordDto],
    description: 'Las rachas invictas mas largas de la historia.',
  })
  streakRecords!: StreakRecordDto[];
}
