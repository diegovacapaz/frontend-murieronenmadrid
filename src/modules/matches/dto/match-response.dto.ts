import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Team } from '../../teams/enums/team.enum';

export class MatchPlayerResponseDto {
  @ApiProperty()
  playerId!: number;

  @ApiProperty({ enum: Team })
  team!: Team;

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

  @ApiProperty({ type: [MatchPlayerResponseDto] })
  players!: MatchPlayerResponseDto[];
}
