import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TournamentState } from '../../tournaments/enums/tournament-state.enum';

export class PenaltyResponseDto {
  @ApiProperty()
  playerId!: number;

  @ApiProperty()
  tournamentId!: number;

  @ApiProperty({ description: 'Puntos que se restan en la tabla.' })
  penalty!: number;

  @ApiProperty()
  playerName!: string;

  @ApiPropertyOptional({ nullable: true })
  playerPhoto!: string | null;

  @ApiProperty()
  tournamentName!: string;

  @ApiProperty({ enum: TournamentState })
  tournamentState!: TournamentState;
}
