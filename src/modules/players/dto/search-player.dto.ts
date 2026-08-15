import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { EntityState } from '../../../common/enums/entity-state.enum';
import { toOptionalBoolean } from '../../../common/helpers/transform.helper';

/**
 * Filtros del listado de jugadores.
 *
 * Deliberadamente chico: el padron son decenas de filas, no miles. No hay
 * paginacion ni operadores — el frontend trae la lista entera y filtra en
 * memoria lo que necesite. Estos tres filtros existen porque los pide el uso
 * real (ver solo activos, armar el equipo Sagrado, buscar por nombre).
 */
export class SearchPlayerDto {
  @ApiPropertyOptional({ enum: EntityState, description: 'A = activo, I = inactivo' })
  @IsOptional()
  @IsEnum(EntityState)
  state?: EntityState;

  @ApiPropertyOptional({ description: 'Filtra por pertenencia al equipo Sagrado.' })
  @IsOptional()
  @Transform(toOptionalBoolean)
  @IsBoolean()
  isSagrado?: boolean;

  @ApiPropertyOptional({ description: 'Busqueda por nombre, apellido o apodo.' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  search?: string;
}
