import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { PlayerAchievements } from './entities/achievement.entity';
import { AchievementFactory } from './helpers/achievement.factory';
import { AchievementCountDB, AchievementDB } from './interfaces/database';
import { IAchievementsRepository } from './interfaces/achievements.repository.interface';

/**
 * Una sola llamada para toda la pantalla. El orden de la desestructuracion es
 * el contrato con procedures/achievements.sql.
 */
@Injectable()
export class AchievementsRepository implements IAchievementsRepository {
  constructor(private readonly db: DatabaseService) {}

  async findByPlayer(playerId: number): Promise<PlayerAchievements> {
    const [achievements, summary] = await this.db.callMulti<
      [AchievementDB[], AchievementCountDB[]]
    >('GetPlayerAchievements', [playerId]);

    return {
      achievements: AchievementFactory.toAchievementList(achievements),
      summary: AchievementFactory.toSummary(summary),
    };
  }
}
