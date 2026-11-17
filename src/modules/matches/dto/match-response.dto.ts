import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Team } from '../../teams/enums/team.enum';
import { MatchState } from '../enums/match-state.enum';

export class MatchPlayerResponseDto {
  @ApiProperty()
  playerId!: number;

  @ApiPropertyOptional({ enum: Team, nullable: true, description: 'null solo en preparacion' })
  team!: Team | null;

  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  secondName!: string;

  @ApiPropertyOptional({ nullable: true })
  nickname!: string | null;

  @ApiProperty()
  displayName!: string;

  @ApiPropertyOptional({ nullable: true })
  photo!: string | null;
}

export class MatchGuestResponseDto {
  @ApiProperty()
  guestId!: number;

  @ApiProperty()
  name!: string;

  @ApiPropertyOptional({ enum: Team, nullable: true })
  team!: Team | null;
}

export class MatchResponseDto {
  @ApiProperty()
  matchId!: number;

  @ApiProperty()
  tournamentId!: number;

  @ApiProperty()
  tournamentName!: string;

  @ApiPropertyOptional({ enum: Team, nullable: true, description: 'null = empate' })
  winnerTeam!: Team | null;

  @ApiProperty({ description: 'Margen sin signo.' })
  goalsDiference!: number;

  @ApiProperty()
  place!: string;

  @ApiProperty()
  playedAt!: Date;

  @ApiProperty()
  isDerby!: boolean;

  @ApiProperty({ enum: MatchState, description: 'P preparacion, R listo, J jugado' })
  state!: MatchState;

  @ApiProperty({ type: [MatchPlayerResponseDto] })
  players!: MatchPlayerResponseDto[];

  @ApiProperty({ type: [MatchGuestResponseDto], description: 'Los randoms. Nunca suman.' })
  guests!: MatchGuestResponseDto[];
}
