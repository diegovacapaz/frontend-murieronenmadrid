import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateTournamentDto {
  @ApiProperty({ maxLength: 40, example: 'Clausura 2026' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  name!: string;

  @ApiProperty({ description: 'Fecha ISO 8601.', example: '2026-07-21T00:00:00.000Z' })
  @Type(() => Date)
  @IsDate()
  startedAt!: Date;

  @ApiProperty({ description: 'Fecha ISO 8601. No puede ser anterior al inicio.' })
  @Type(() => Date)
  @IsDate()
  endedAt!: Date;

  @ApiProperty({ description: 'Puntos por ganar un partido.', example: 3 })
  @IsNumber()
  @Min(0)
  winningPoints!: number;

  @ApiProperty({ description: 'Puntos por empatar.', example: 1 })
  @IsNumber()
  @Min(0)
  drawingPoints!: number;

  @ApiProperty({
    description: 'Puntos por perder. Puede ser fraccionario (la Clausura 2025 pago 0.25).',
    example: 0.25,
  })
  @IsNumber()
  @Min(0)
  lossingPoints!: number;

  @ApiPropertyOptional({
    default: true,
    description:
      'false para un torneo del que solo se conserva la tabla final: se cargan ' +
      'partidos para reproducirla, sin marcadores, y el frontend no los lista.',
  })
  @IsOptional()
  @IsBoolean()
  wasTracked?: boolean;
}
