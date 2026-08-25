import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

/** Lo que devuelve la lectura. */
export class ConfigResponseDto {
  @ApiProperty({ maxLength: 60, example: 'MurieronNews' })
  paperName!: string;

  @ApiProperty({
    nullable: true,
    description: 'El trasfondo del grupo que el prompt usa para darle color al diario.',
  })
  groupLore!: string | null;

  @ApiProperty({
    nullable: true,
    description:
      'Instrucciones de estilo para el modelo. Tan interno como el lore de los ' +
      'jugadores: por eso este endpoint exige @AdminOnly().',
  })
  styleGuide!: string | null;

  @ApiProperty({
    description: 'El corte de abajo de los dos. En false, ni el cron ni el botón publican.',
  })
  isEnabled!: boolean;
}

/** Lo que acepta la escritura. Es un PUT: reemplaza la fila entera. */
export class UpdateConfigDto {
  @ApiProperty({ maxLength: 60, example: 'MurieronNews' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  paperName!: string;

  @ApiPropertyOptional({
    nullable: true,
    maxLength: 8000,
    description: 'Vacío o ausente borra el lore.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  groupLore?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    maxLength: 8000,
    description: 'Vacío o ausente borra la guía de estilo.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  styleGuide?: string | null;

  @ApiProperty()
  @IsBoolean()
  isEnabled!: boolean;
}
