import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, Min } from 'class-validator';
import { toOptionalBoolean } from '../../../common/helpers/transform.helper';

export class SearchMatchDto {
  @ApiPropertyOptional({ description: 'Partidos de un torneo.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  tournamentId?: number;

  @ApiPropertyOptional({ description: 'Solo derbies, o solo partidos comunes.' })
  @IsOptional()
  @Transform(toOptionalBoolean)
  @IsBoolean()
  isDerby?: boolean;

  @ApiPropertyOptional({ description: 'Partidos en los que jugo un jugador.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  playerId?: number;
}
