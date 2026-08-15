import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AppErrorCode } from '../../common/constants/error-codes.constants';
import { TeamResponseDto } from './dto/team-response.dto';
import { Team } from './enums/team.enum';
import type { ITeamsRepository } from './interfaces/teams.repository.interface';
import { TEAMS_REPOSITORY } from './teams.constants';

/**
 * Teams es un catalogo de solo lectura: una fila por letra de la enum,
 * sembrada con el schema. No hay alta, baja ni modificacion — agregar un equipo
 * seria un cambio de modelo, no un dato que se carga.
 *
 * El endpoint existe para que el frontend arme sus selectores y sepa cuales son
 * los equipos del derby sin hardcodear las letras.
 */
@Injectable()
export class TeamsService {
  constructor(
    @Inject(TEAMS_REPOSITORY)
    private readonly teamsRepository: ITeamsRepository,
  ) {}

  async search(isDerbyTeam?: boolean): Promise<TeamResponseDto[]> {
    const teams = await this.teamsRepository.search(isDerbyTeam);
    return teams.map((team) => ({ team: team.team, isDerbyTeam: team.isDerbyTeam }));
  }

  async findOneById(team: Team): Promise<TeamResponseDto> {
    const found = await this.teamsRepository.findById(team);

    if (!found) {
      throw new NotFoundException({
        message: 'Team not found',
        errorCode: AppErrorCode.TEAM_NOT_FOUND,
      });
    }

    return { team: found.team, isDerbyTeam: found.isDerbyTeam };
  }
}
