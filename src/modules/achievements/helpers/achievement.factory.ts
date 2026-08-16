import {
  Achievement,
  AchievementCount,
  AchievementSummary,
} from '../entities/achievement.entity';
import { AchievementCategory } from '../enums/achievement.enums';
import { AchievementCountDB, AchievementDB } from '../interfaces/database';

/**
 * Arma las entidades de logros desde las filas de la base.
 *
 * Lo único que hace además de copiar campos es desarmar el ROLLUP: la fila con
 * category en null es el total, y las otras tres son las categorías. Se separan
 * acá para que el frontend reciba `{ all, byCategory }` y no tenga que saber
 * que del otro lado hubo un GROUP BY ... WITH ROLLUP.
 */
export class AchievementFactory {
  static toAchievement(db: AchievementDB): Achievement {
    const achievement = new Achievement();
    achievement.code = db.code;
    achievement.category = db.category;
    achievement.title = db.title;
    achievement.description = db.description;
    achievement.isBreakable = db.isBreakable;
    achievement.state = db.state;
    achievement.progress = db.progress;
    achievement.target = db.target;
    return achievement;
  }

  static toAchievementList(dbs: AchievementDB[]): Achievement[] {
    return dbs.map((db) => AchievementFactory.toAchievement(db));
  }

  static toSummary(dbs: AchievementCountDB[]): AchievementSummary {
    const summary = new AchievementSummary();

    // Las tres categorías arrancan en cero: si un jugador no tuviera filas de
    // alguna, la pantalla igual tiene que poder pintar su contador.
    summary.byCategory = {
      [AchievementCategory.GENERAL]: AchievementFactory.emptyCount(),
      [AchievementCategory.SUPERCLASICO]: AchievementFactory.emptyCount(),
      [AchievementCategory.MUNDIALITO]: AchievementFactory.emptyCount(),
    };
    summary.all = AchievementFactory.emptyCount();

    for (const db of dbs) {
      const count = new AchievementCount();
      count.obtained = db.obtained;
      count.total = db.total;

      if (db.category === null) {
        summary.all = count;
      } else {
        summary.byCategory[db.category] = count;
      }
    }

    return summary;
  }

  private static emptyCount(): AchievementCount {
    const count = new AchievementCount();
    count.obtained = 0;
    count.total = 0;
    return count;
  }
}
