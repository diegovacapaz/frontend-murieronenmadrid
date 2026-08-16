import { AchievementCategory, AchievementState } from '../enums/achievement.enums';

/**
 * Un logro visto desde un jugador: el catalogo mas su estado.
 *
 * No hay entidad "logro suelto" porque no existe fuera de alguien que lo tenga
 * o no lo tenga: el catalogo por si solo no se expone en ningun endpoint.
 */
export class Achievement {
  code!: string;
  category!: AchievementCategory;
  title!: string;
  description!: string;
  /** Si es una maldicion, es decir, si esta medalla puede terminar rota. */
  isBreakable!: boolean;
  state!: AchievementState;
  /**
   * Cuanto lleva y cuanto necesita. Van en null en los logros de evento —salir
   * campeon no tiene media medalla— y ahi el frontend no dibuja barra.
   */
  progress!: number | null;
  target!: number | null;
}

/** Cuantos lleva sobre el total, para los contadores de la pantalla. */
export class AchievementCount {
  obtained!: number;
  total!: number;
}

/**
 * El resumen de la solapa. `byCategory` trae las tres familias y `all` el total,
 * que es lo que muestra el boton del perfil.
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
