import { ApiProperty } from '@nestjs/swagger';
import { ArticleSection, PlayerRole } from '../enums/newsletter.enums';

export class ArticlePlayerDto {
  @ApiProperty()
  playerId!: number;

  @ApiProperty({
    description: 'El apodo si lo tiene, el nombre completo si no. Lo resuelve vPlayerDetail.',
    example: 'Bauti',
  })
  displayName!: string;

  @ApiProperty({ nullable: true, description: 'Foto del jugador, si cargó una.' })
  photo!: string | null;

  @ApiProperty({
    enum: PlayerRole,
    description: 'Qué papel juega en la nota. Decide qué foto la ilustra.',
  })
  role!: PlayerRole;
}

export class ArticleDto {
  @ApiProperty()
  articleId!: number;

  @ApiProperty({ enum: ArticleSection, description: 'La sección del diario donde va la nota.' })
  section!: ArticleSection;

  @ApiProperty({ example: 'Prueba de portada' })
  headline!: string;

  @ApiProperty({ description: 'El copete: la bajada que va debajo del titular.' })
  standfirst!: string;

  @ApiProperty({ description: 'El cuerpo de la nota.' })
  body!: string;

  @ApiProperty({ description: 'Posición dentro de la edición, de menor a mayor.' })
  sortOrder!: number;

  @ApiProperty({ description: 'Si un administrador corrigió el texto que escribió el modelo.' })
  isEdited!: boolean;

  @ApiProperty({ type: ArticlePlayerDto, isArray: true })
  players!: ArticlePlayerDto[];
}

export class EditionResponseDto {
  @ApiProperty({ description: 'Número de edición. El primer diario es el 1.' })
  editionNumber!: number;

  @ApiProperty({ description: 'Fecha de la edición, YYYY-MM-DD.', example: '2026-08-24' })
  publishedOn!: string;

  @ApiProperty({ description: 'Momento exacto de la publicación, ISO con Z.' })
  publishedAt!: string;

  @ApiProperty({ type: ArticleDto, isArray: true })
  articles!: ArticleDto[];
}

/** Una fila del archivo: lo mínimo para listar sin traer los cuerpos. */
export class EditionSummaryDto {
  @ApiProperty()
  editionNumber!: number;

  @ApiProperty({ example: '2026-08-24' })
  publishedOn!: string;

  @ApiProperty({
    description: 'El titular de la portada. Vacío en la edición que no tenga.',
  })
  headline!: string;
}
