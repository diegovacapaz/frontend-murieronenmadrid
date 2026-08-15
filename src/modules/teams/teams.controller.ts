import { Controller, Get, Param, ParseEnumPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ApiRoute, ApiTag } from '../../common/constants';
import { SearchTeamDto } from './dto/search-team.dto';
import { TeamResponseDto } from './dto/team-response.dto';
import { Team } from './enums/team.enum';
import { TeamsService } from './teams.service';

@ApiTags(ApiTag.TEAMS)
@Controller(ApiRoute.TEAMS)
export class TeamsController {
  constructor(private readonly teamsService: TeamsService) {}

  @Get()
  @ApiOperation({
    summary: 'Listar equipos',
    description:
      'Catalogo fijo de solo lectura. Sirve para que el frontend no hardcodee ' +
      'las letras ni cuales son los equipos del derby.',
  })
  search(@Query() filterDto: SearchTeamDto): Promise<TeamResponseDto[]> {
    return this.teamsService.search(filterDto.isDerbyTeam);
  }

  @Get(':team')
  @ApiOperation({ summary: 'Obtener un equipo por su letra' })
  @ApiResponse({ status: 404, description: 'Equipo no encontrado' })
  findOneById(
    @Param('team', new ParseEnumPipe(Team)) team: Team,
  ): Promise<TeamResponseDto> {
    return this.teamsService.findOneById(team);
  }
}
