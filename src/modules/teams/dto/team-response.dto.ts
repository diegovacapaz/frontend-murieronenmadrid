import { ApiProperty } from '@nestjs/swagger';
import { Team } from '../enums/team.enum';

export class TeamResponseDto {
  @ApiProperty({ enum: Team, description: 'D = Dark, L = Light, S = Sagrado, R = Resto del Mundo' })
  team!: Team;

  @ApiProperty({ description: 'true en los equipos que disputan el derby (Sagrado y Resto).' })
  isDerbyTeam!: boolean;
}
