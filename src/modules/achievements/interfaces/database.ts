import type { Row } from '../../../database/database.types';
import type { AchievementCategory, AchievementState } from '../enums/achievement.enums';

/** Primer result set de GetPlayerAchievements. */
export interface AchievementDB extends Row {
  code: string;
  category: AchievementCategory;
  title: string;
  description: string;
  isBreakable: boolean;
  state: AchievementState;
  progress: number | null;
  target: number | null;
}

/**
 * Segundo result set. `category` viene en null en la fila del ROLLUP, que es el
 * total de las tres familias juntas.
 */
export interface AchievementCountDB extends Row {
  category: AchievementCategory | null;
  obtained: number;
  total: number;
}
