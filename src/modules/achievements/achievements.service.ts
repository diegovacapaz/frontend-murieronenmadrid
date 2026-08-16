import { Inject, Injectable } from '@nestjs/common';
import { PlayerAchievementsResponseDto } from './dto/achievement-response.dto';
import type { IAchievementsRepository } from './interfaces/achievements.repository.interface';
import { ACHIEVEMENTS_REPOSITORY } from './achievements.constants';

/**
 * No calcula nada, y esa es la idea: las 28 reglas viven en
 * vPlayerAchievements. Si alguna se repitiera acá existirían dos versiones del
 * mismo logro y tarde o temprano dirían cosas distintas.
 *
 * El 404 de jugador inexistente lo señaliza el SP.
 */
@Injectable()
export class AchievementsService {
  constructor(
    @Inject(ACHIEVEMENTS_REPOSITORY)
    private readonly achievementsRepository: IAchievementsRepository,
  ) {}

  async findByPlayer(playerId: number): Promise<PlayerAchievementsResponseDto> {
    return this.achievementsRepository.findByPlayer(playerId);
  }
}
