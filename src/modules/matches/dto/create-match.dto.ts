import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDate,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Team } from '../../teams/enums/team.enum';

export class MatchPlayerDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  playerId!: number;

  @ApiProperty({ enum: Team })
  @IsEnum(Team)
  team!: Team;
}

export class CreateMatchDto {
  @ApiProperty({ description: 'Torneo al que se agrega. Tiene que estar en juego.' })
  @IsInt()
  @Min(1)
  tournamentId!: number;

  @ApiPropertyOptional({
    enum: Team,
    nullable: true,
    description: 'Equipo ganador. null = empate.',
  })
  @IsOptional()
  @IsEnum(Team)
  winnerTeam?: Team | null;

  @ApiProperty({
    description:
      'Margen SIN signo. 0 en un empate. De que lado cae lo dice winnerTeam.',
    example: 3,
  })
  @IsInt()
  @Min(0)
  goalsDiference!: number;

  @ApiProperty({ maxLength: 40, example: 'LACONQUIJA' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  place!: string;

  @ApiProperty({ description: 'Fecha y hora ISO 8601.' })
  @Type(() => Date)
  @IsDate()
  playedAt!: Date;

  @ApiPropertyOptional({
    default: false,
    description:
      'true si es un derby. Un derby solo admite equipos Sagrado y Resto del ' +
      'Mundo; uno comun, solo Dark y Light.',
  })
  @IsOptional()
  @IsBoolean()
  isDerby?: boolean;

  @ApiProperty({
    type: [MatchPlayerDto],
    description:
      'La convocatoria completa: quien jugo y en que equipo. Reemplaza a la ' +
      'anterior en una edicion.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => MatchPlayerDto)
  players!: MatchPlayerDto[];

  @ApiPropertyOptional({
    maxLength: 2000,
    description:
      'Notas del administrador sobre lo que pasó esa tarde: el clima, la ' +
      'cancha, quién faltó, lo que ningún resultado puede contar. Solo las ' +
      'lee el diario. Vaciarlas borra las notas del partido.',
    example: 'Llovía toda la tarde y la cancha era un barrial.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
