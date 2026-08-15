import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EntityState } from '../../../common/enums/entity-state.enum';
import { PlayerChampionshipDto } from '../../players/dto/player-response.dto';

export class StandingResponseDto {
  @ApiProperty({ description: 'Posicion ya resuelta por la base, con el desempate oficial.' })
  position!: number;

  @ApiProperty()
  playerId!: number;

  @ApiProperty()
  displayName!: string;

  @ApiPropertyOptional({ nullable: true })
  nickname!: string | null;

  @ApiPropertyOptional({ nullable: true })
  photo!: string | null;

  @ApiProperty({ enum: EntityState })
  playerState!: EntityState;

  @ApiProperty()
  isSagrado!: boolean;

  @ApiProperty({ description: 'Torneos ganados: las estrellas del jugador.' })
  cups!: number;

  @ApiProperty()
  played!: number;

  @ApiProperty()
  won!: number;

  @ApiProperty()
  drew!: number;

  @ApiProperty()
  lost!: number;

  @ApiProperty({ description: 'Diferencia de gol acumulada, con signo.' })
  goalsDiference!: number;

  @ApiProperty({ description: 'Puntos brutos, sin restar penalizacion.' })
  points!: number;

  @ApiProperty({ description: 'Techo posible: winningPoints x partidos jugados.' })
  maxPoints!: number;

  @ApiPropertyOptional({
    nullable: true,
    description: 'points / maxPoints. null si no jugo nada.',
  })
  winRate!: number | null;

  @ApiProperty()
  penalty!: number;

  @ApiProperty({ description: 'points - penalty. Define al campeon.' })
  netPoints!: number;
}

export class GeneralStandingResponseDto extends StandingResponseDto {
  @ApiProperty()
  tournamentsPlayed!: number;

  @ApiProperty({ type: [PlayerChampionshipDto] })
  championships!: PlayerChampionshipDto[];
}
