import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
} from 'class-validator';

export class CreatePlayerDto {
  @ApiProperty({ maxLength: 20, example: 'Diego' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  firstName!: string;

  @ApiProperty({ maxLength: 20, example: 'Vaca' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  secondName!: string;

  @ApiPropertyOptional({
    maxLength: 20,
    description: 'Como se lo conoce. Si esta, es lo que se muestra en tablas y perfiles.',
    example: 'Pulga',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  nickname?: string;

  @ApiPropertyOptional({ maxLength: 255, description: 'URL de la foto de perfil.' })
  @IsOptional()
  @IsUrl({ require_tld: false })
  @MaxLength(255)
  photo?: string;

  @ApiPropertyOptional({
    default: false,
    description: 'Si forma parte del equipo Sagrado (el subconjunto que juega los derbies).',
  })
  @IsOptional()
  @IsBoolean()
  isSagrado?: boolean;
}
