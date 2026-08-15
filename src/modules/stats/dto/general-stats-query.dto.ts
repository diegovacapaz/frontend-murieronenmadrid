import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';

export class GeneralStatsQueryDto {
  @ApiPropertyOptional({
    description:
      'Minimo de partidos para entrar al ranking de winrate. Por defecto 10, ' +
      'para que el podio no lo copen los que jugaron dos veces.',
    default: 10,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minMatches?: number;
}
