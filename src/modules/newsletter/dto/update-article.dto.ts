import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Corrección manual de una nota ya publicada.
 *
 * Los tres topes son los mismos que le dan a la herramienta `publicarEdicion`
 * (ver `newsletter.tool.ts`): si el modelo no puede pasarse de ahí, un
 * administrador corrigiéndole el texto a mano tampoco debería poder.
 *
 * Los tres campos son opcionales porque es un PATCH, no un PUT: mandar solo
 * `headline` corrige el titular y deja el resto de la nota como estaba.
 */
export class UpdateArticleDto {
  @ApiPropertyOptional({ maxLength: 90, example: 'Titular editado a mano' })
  @IsOptional()
  @IsString()
  @MaxLength(90)
  headline?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  standfirst?: string;

  @ApiPropertyOptional({ maxLength: 1600 })
  @IsOptional()
  @IsString()
  @MaxLength(1600)
  body?: string;
}
