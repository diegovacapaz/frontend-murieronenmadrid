import { ApiProperty } from '@nestjs/swagger';

export class PoweradeMovementDto {
  @ApiProperty({
    enum: ['sube', 'baja', 'igual', 'entra'],
    description: 'Cómo se movió respecto de la versión anterior. `entra` es quien no estaba en su top 3.',
  })
  tipo!: 'sube' | 'baja' | 'igual' | 'entra';

  @ApiProperty({ description: 'Cuántos lugares; 0 para `igual` y `entra`.' })
  lugares!: number;
}

export class PoweradeEntryDto {
  @ApiProperty({ description: 'El puesto, de 1 a 3.' })
  position!: number;

  @ApiProperty()
  playerId!: number;

  @ApiProperty({ example: 'David' })
  displayName!: string;

  @ApiProperty({ nullable: true, description: 'Foto del jugador, si cargó una.' })
  photo!: string | null;

  @ApiProperty({ description: 'Torneos ganados: dibuja el anillo dorado del avatar.' })
  cups!: number;

  @ApiProperty({ description: 'La frase de por qué ese puesto, escrita por la IA.' })
  reason!: string;

  @ApiProperty({
    type: PoweradeMovementDto,
    nullable: true,
    description: '`null` cuando no hay versión anterior con la que comparar.',
  })
  movement!: PoweradeMovementDto | null;
}

export class PoweradeResponseDto {
  @ApiProperty({ description: 'Número de la versión vigente del ranking de este torneo.' })
  version!: number;

  @ApiProperty({ description: 'El último partido del torneo que el redactor tuvo delante.' })
  lastMatchId!: number;

  @ApiProperty({ description: 'Cuándo se publicó (ISO, UTC).' })
  publishedAt!: string;

  @ApiProperty({ description: 'Cuántos partidos del torneo cuenta el ranking.' })
  partidosContados!: number;

  @ApiProperty({
    description: 'Cuántos partidos se cargaron desde entonces: si es mayor que 0, el ranking está viejo.',
  })
  partidosNuevos!: number;

  @ApiProperty({ type: PoweradeEntryDto, isArray: true })
  entries!: PoweradeEntryDto[];
}
