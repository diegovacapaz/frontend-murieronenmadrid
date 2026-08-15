import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TournamentState } from '../enums/tournament-state.enum';

export class TournamentResponseDto {
  @ApiProperty()
  tournamentId!: number;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  startedAt!: Date;

  @ApiProperty()
  endedAt!: Date;

  @ApiProperty({ enum: TournamentState })
  state!: TournamentState;

  @ApiProperty()
  wasTracked!: boolean;

  @ApiProperty()
  winningPoints!: number;

  @ApiProperty()
  drawingPoints!: number;

  @ApiProperty()
  lossingPoints!: number;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty({ description: 'Partidos cargados.' })
  matchesCount!: number;

  @ApiProperty({ description: 'Cuantos de esos partidos fueron derbies.' })
  derbiesCount!: number;

  @ApiProperty({ description: 'Jugadores distintos que participaron.' })
  playersCount!: number;

  @ApiProperty({ description: 'Penalizaciones cargadas.' })
  penaltiesCount!: number;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Solo en torneos finalizados; null mientras se juega.',
  })
  championPlayerId!: number | null;

  @ApiPropertyOptional({ nullable: true })
  championName!: string | null;
}
