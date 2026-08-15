import { Inject, Injectable } from '@nestjs/common';
import {
  GeneralStandingResponseDto,
  StandingResponseDto,
} from './dto/standing-response.dto';
import type { IScoreboardRepository } from './interfaces/scoreboard.repository.interface';
import { SCOREBOARD_REPOSITORY } from './scoreboard.constants';

/**
 * Este service casi no hace nada, y eso es a proposito: las tablas se calculan
 * y se ordenan en la base. Si aca hubiera un `.sort()`, existirian dos
 * criterios de desempate en el sistema y tarde o temprano dirian cosas
 * distintas.
 *
 * El 404 de torneo inexistente lo señaliza el SP.
 */
@Injectable()
export class ScoreboardService {
  constructor(
    @Inject(SCOREBOARD_REPOSITORY)
    private readonly scoreboardRepository: IScoreboardRepository,
  ) {}

  async findByTournament(tournamentId: number): Promise<StandingResponseDto[]> {
    return this.scoreboardRepository.findByTournament(tournamentId);
  }

  async findGeneral(): Promise<GeneralStandingResponseDto[]> {
    return this.scoreboardRepository.findGeneral();
  }
}
