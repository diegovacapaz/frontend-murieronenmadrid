import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { toOptionalBoolean } from '../../../common/helpers/transform.helper';

export class SearchTeamDto {
  @ApiPropertyOptional({ description: 'true devuelve solo los equipos del derby.' })
  @IsOptional()
  @Transform(toOptionalBoolean)
  @IsBoolean()
  isDerbyTeam?: boolean;
}
