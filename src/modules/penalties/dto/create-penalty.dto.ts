import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsNumber, IsPositive, Min } from 'class-validator';

export class CreatePenaltyDto {
  @ApiProperty({ description: 'Torneo en el que se aplica. Tiene que estar en juego.' })
  @IsInt()
  @Min(1)
  tournamentId!: number;

  @ApiProperty()
  @IsInt()
  @Min(1)
  playerId!: number;

  @ApiProperty({
    description: 'Puntos a restar. Mayor a cero; admite fracciones.',
    example: 1.5,
  })
  @IsNumber()
  @IsPositive()
  penalty!: number;
}
