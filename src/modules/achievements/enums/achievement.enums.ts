/**
 * Las tres familias de logros. El texto lo pone el frontend: acá solo viaja la
 * letra, como en todos los estados del modelo.
 */
export enum AchievementCategory {
  /** Torneos, partidos y todo lo que no es superclásico ni mundialito. */
  GENERAL = 'G',
  SUPERCLASICO = 'S',
  MUNDIALITO = 'M',
}

/**
 * En qué estado está un logro para un jugador.
 *
 * No hay un boolean porque son tres casos: la maldición rota no es lo mismo que
 * no haberlo conseguido todavía. Gris dice "todavía podés", roto dice "se
 * terminó".
 */
export enum AchievementState {
  /** Todavía no lo tiene, sigue alcanzable. Medalla gris. */
  LOCKED = 'L',
  /** Cumplido. Medalla dorada, sea un logro lindo o vergonzoso. */
  UNLOCKED = 'U',
  /** La condición ya no puede cumplirse nunca. Medalla agrietada. */
  BROKEN = 'B',
}
