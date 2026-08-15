import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { toOptionalBoolean } from '../../../common/helpers/transform.helper';
import { TournamentState } from '../enums/tournament-state.enum';

export class SearchTournamentDto {
  @ApiPropertyOptional({ enum: TournamentState, description: 'P = en juego, F = finalizado' })
  @IsOptional()
  @IsEnum(TournamentState)
  state?: TournamentState;

  @ApiPropertyOptional({ description: 'Filtra por torneos con o sin detalle de partidos.' })
  @IsOptional()
  @Transform(toOptionalBoolean)
  @IsBoolean()
  wasTracked?: boolean;
}
