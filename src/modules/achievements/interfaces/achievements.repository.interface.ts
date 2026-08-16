import type { PlayerAchievements } from '../entities/achievement.entity';

export interface IAchievementsRepository {
  findByPlayer(playerId: number): Promise<PlayerAchievements>;
}
