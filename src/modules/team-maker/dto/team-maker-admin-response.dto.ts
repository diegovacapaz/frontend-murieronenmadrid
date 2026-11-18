import { ApiProperty } from '@nestjs/swagger';

/**
 * Lo que necesita el admin para compartir el link de capitanes:
 * /partidos/:matchId/armado?c=<captainCode>.
 */
export class TeamMakerAdminResponseDto {
  @ApiProperty()
  makerId!: number;

  @ApiProperty({ description: 'Codigo secreto del link de capitanes (22 caracteres).' })
  captainCode!: string;

  @ApiProperty({ enum: ['W', 'K', 'V', 'F', 'C'] })
  status!: string;
}
