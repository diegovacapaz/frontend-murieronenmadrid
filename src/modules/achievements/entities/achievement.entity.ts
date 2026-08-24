import { AchievementCategory, AchievementState } from '../enums/achievement.enums';

/**
 * Un logro visto desde un jugador: el catálogo más su estado.
 *
 * No hay entidad "logro suelto" porque no existe fuera de alguien que lo tenga
 * o no lo tenga: el catálogo por sí solo no se expone en ningún endpoint.
 */
export class Achievement {
  code!: string;
  category!: AchievementCategory;
  title!: string;
  description!: string;
  /** Si es una maldición, es decir, si esta medalla puede terminar rota. */
  isBreakable!: boolean;
  state!: AchievementState;
  /**
   * Cuánto lleva y cuánto necesita. Van en null en los logros de evento —salir
   * campeón no tiene media medalla— y ahí el frontend no dibuja barra.
   */
  progress!: number | null;
  target!: number | null;
}

/** Cuántos lleva sobre el total, para los contadores de la pantalla. */
export class AchievementCount {
  obtained!: number;
  total!: number;
}

/**
 * El resumen de la solapa. `byCategory` trae las tres familias y `all` el total,
 * que es lo que muestra el botón del perfil.
 *
 * Los rotos no cuentan como obtenidos.
 */
export class AchievementSummary {
  all!: AchievementCount;
  byCategory!: Record<AchievementCategory, AchievementCount>;
}

/** Lo que devuelve el endpoint. */
export class PlayerAchievements {
  achievements!: Achievement[];
  summary!: AchievementSummary;
}
