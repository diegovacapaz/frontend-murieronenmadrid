import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { Team } from '../../teams/enums/team.enum';

/** El resultado y el relato de un partido listo. Desde aca, cuenta. */
export class FinishMatchDto {
  @ApiPropertyOptional({ enum: Team, nullable: true, description: 'null = empate' })
  @IsOptional()
  @IsEnum(Team)
  winnerTeam?: Team | null;

  @ApiProperty({ description: 'Margen sin signo. 0 en un empate.', example: 3 })
  @IsInt()
  @Min(0)
  goalsDiference!: number;

  @ApiPropertyOptional({ maxLength: 2000, description: 'El relato: lo que paso esa tarde.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
