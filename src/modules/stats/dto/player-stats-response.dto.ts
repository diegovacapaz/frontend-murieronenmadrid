import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EntityState } from '../../../common/enums/entity-state.enum';
import { MatchResult } from '../../matches/enums/match-result.enum';
import { PlayerChampionshipDto } from '../../players/dto/player-response.dto';
import { Team } from '../../teams/enums/team.enum';
import { TournamentState } from '../../tournaments/enums/tournament-state.enum';
import { StatHighlightKind } from '../enums/stat-highlight-kind.enum';

export class PlayerStatsSummaryDto {
  @ApiProperty() playerId!: number;
  @ApiProperty() displayName!: string;
  @ApiProperty() firstName!: string;
  @ApiProperty() secondName!: string;
  @ApiPropertyOptional({ nullable: true }) nickname!: string | null;
  @ApiPropertyOptional({ nullable: true }) photo!: string | null;
  @ApiProperty({ enum: EntityState }) state!: EntityState;
  @ApiProperty() isSagrado!: boolean;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() cups!: number;
  @ApiProperty({ type: [PlayerChampionshipDto] })
  championships!: PlayerChampionshipDto[];

  @ApiPropertyOptional({
    nullable: true,
    description: 'Posicion en la tabla historica. null si todavia no jugo.',
  })
  position!: number | null;

  @ApiProperty() tournamentsPlayed!: number;
  @ApiProperty() played!: number;
  @ApiProperty() won!: number;
  @ApiProperty() drew!: number;
  @ApiProperty() lost!: number;
  @ApiProperty() goalsDiference!: number;
  @ApiProperty() points!: number;
  @ApiProperty() maxPoints!: number;
  @ApiPropertyOptional({ nullable: true }) winRate!: number | null;
  @ApiProperty() penalty!: number;
  @ApiProperty() netPoints!: number;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Torneo de su primer partido. Se deduce, no se edita.',
  })
  debutTournamentId!: number | null;

  @ApiPropertyOptional({ nullable: true }) debutTournamentName!: string | null;
}

export class PlayerTournamentStatDto {
  @ApiProperty() tournamentId!: number;
  @ApiProperty() tournamentName!: string;
  @ApiProperty({ enum: TournamentState }) tournamentState!: TournamentState;
  @ApiProperty() wasTracked!: boolean;
  @ApiProperty() startedAt!: Date;
  @ApiProperty() position!: number;
  @ApiProperty() played!: number;
  @ApiProperty() won!: number;
  @ApiProperty() drew!: number;
  @ApiProperty() lost!: number;
  @ApiProperty() goalsDiference!: number;
  @ApiProperty() points!: number;
  @ApiProperty() maxPoints!: number;
  @ApiPropertyOptional({ nullable: true }) winRate!: number | null;
  @ApiProperty() penalty!: number;
  @ApiProperty() netPoints!: number;
  @ApiProperty({ description: 'true si salio campeon de ese torneo.' })
  isChampion!: boolean;
}

export class WinRateSeriesPointDto {
  @ApiProperty({ description: 'Numero de partido en su carrera, empezando en 1.' })
  matchNumber!: number;

  @ApiProperty() matchId!: number;
  @ApiProperty() tournamentId!: number;
  @ApiProperty() tournamentName!: string;
  @ApiProperty() playedAt!: Date;
  @ApiProperty({ enum: MatchResult }) result!: MatchResult;
  @ApiProperty({ description: 'Diferencia de ese partido, con signo.' })
  goalsDiference!: number;

  @ApiProperty({ description: 'Winrate acumulado hasta este partido, inclusive.' })
  winRate!: number;
}

export class RivalStatDto {
  @ApiProperty() playerId!: number;
  @ApiProperty() displayName!: string;
  @ApiPropertyOptional({ nullable: true }) photo!: string | null;
  @ApiProperty({ description: 'Veces que se enfrentaron.' }) played!: number;
  @ApiProperty() won!: number;
  @ApiProperty() drew!: number;
  @ApiProperty() lost!: number;
  @ApiProperty({ description: 'Victorias menos derrotas contra ese rival.' })
  balance!: number;
  @ApiProperty() winRate!: number;
}

export class PartnerStatDto {
  @ApiProperty() playerId!: number;
  @ApiProperty() displayName!: string;
  @ApiPropertyOptional({ nullable: true }) photo!: string | null;
  @ApiProperty({ description: 'Veces que jugaron en el mismo equipo.' })
  played!: number;
  @ApiProperty() won!: number;
  @ApiProperty() drew!: number;
  @ApiProperty() lost!: number;
  @ApiProperty() winRate!: number;
}

export class StatHighlightDto {
  @ApiProperty({ enum: StatHighlightKind })
  kind!: StatHighlightKind;

  @ApiProperty() playerId!: number;
  @ApiProperty() displayName!: string;
  @ApiPropertyOptional({ nullable: true }) photo!: string | null;
  @ApiProperty() played!: number;
  @ApiProperty() won!: number;
  @ApiProperty() drew!: number;
  @ApiProperty() lost!: number;
  @ApiPropertyOptional({
    nullable: true,
    description: 'Solo en los destacados de rival; null en los de quimica.',
  })
  balance!: number | null;
  @ApiProperty() winRate!: number;
}

export class TeamDistributionDto {
  @ApiProperty({ enum: Team }) team!: Team;
  @ApiProperty() isDerbyTeam!: boolean;
  @ApiProperty() played!: number;
  @ApiProperty() won!: number;
  @ApiProperty() drew!: number;
  @ApiProperty() lost!: number;
  @ApiProperty() winRate!: number;
}

/** Todo el perfil de un jugador en una sola respuesta. */
export class PlayerStreaksDto {
  @ApiProperty()
  playerId!: number;

  @ApiProperty({ description: 'La racha invicta mas larga que tuvo.' })
  bestUnbeaten!: number;

  @ApiPropertyOptional({ nullable: true, description: 'ISO con Z.' })
  bestUnbeatenEndedAt!: string | null;

  @ApiProperty({ description: 'Victorias seguidas, su maximo.' })
  bestWin!: number;

  @ApiPropertyOptional({ nullable: true })
  bestWinEndedAt!: string | null;

  @ApiProperty({ description: 'La peor sequia: partidos seguidos sin ganar.' })
  worstWinless!: number;

  @ApiProperty({ description: 'Racha invicta abierta. 0 si el ultimo lo perdio.' })
  currentUnbeaten!: number;

  @ApiProperty({ description: 'Partidos sin ganar abiertos. 0 si el ultimo lo gano.' })
  currentWinless!: number;
}

export class PlayerActivityDto {
  @ApiProperty()
  matchId!: number;

  @ApiProperty()
  tournamentId!: number;

  @ApiProperty()
  tournamentName!: string;

  @ApiProperty()
  playedAt!: Date;

  @ApiPropertyOptional({ enum: MatchResult, nullable: true, description: 'null = falto.' })
  result!: MatchResult | null;

  @ApiPropertyOptional({ enum: Team, nullable: true })
  team!: Team | null;
}

export class PlayerStatsResponseDto {
  @ApiProperty({ type: PlayerStatsSummaryDto })
  summary!: PlayerStatsSummaryDto;

  @ApiProperty({ type: [PlayerTournamentStatDto] })
  perTournament!: PlayerTournamentStatDto[];

  @ApiProperty({
    type: [WinRateSeriesPointDto],
    description: 'Serie para el grafico de evolucion.',
  })
  winRateSeries!: WinRateSeriesPointDto[];

  @ApiProperty({ type: [RivalStatDto] })
  rivals!: RivalStatDto[];

  @ApiProperty({ type: [PartnerStatDto] })
  partners!: PartnerStatDto[];

  @ApiProperty({
    type: [StatHighlightDto],
    description: 'Victima, verdugo, clasico y las dos puntas de la quimica.',
  })
  highlights!: StatHighlightDto[];

  @ApiProperty({ type: [TeamDistributionDto] })
  teamDistribution!: TeamDistributionDto[];

  @ApiProperty({ type: PlayerStreaksDto })
  streaks!: PlayerStreaksDto;

  @ApiProperty({
    type: [PlayerActivityDto],
    description: 'Todos los partidos del grupo; result en null es una ausencia.',
  })
  activity!: PlayerActivityDto[];
}
