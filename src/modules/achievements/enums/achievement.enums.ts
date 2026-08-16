/**
 * Las tres familias de logros. El texto lo pone el frontend: aca solo viaja la
 * letra, como en todos los estados del modelo.
 */
export enum AchievementCategory {
  /** Torneos, partidos y todo lo que no es superclasico ni mundialito. */
  GENERAL = 'G',
  SUPERCLASICO = 'S',
  MUNDIALITO = 'M',
}

/**
 * En que estado esta un logro para un jugador.
 *
 * No hay un boolean porque son tres casos: la maldicion rota no es lo mismo que
 * no haberlo conseguido todavia. Gris dice "todavia podes", roto dice "se
 * termino".
 */
export enum AchievementState {
  /** Todavia no lo tiene, sigue alcanzable. Medalla gris. */
  LOCKED = 'L',
  /** Cumplido. Medalla dorada, sea un logro lindo o vergonzoso. */
  UNLOCKED = 'U',
  /** La condicion ya no puede cumplirse nunca. Medalla agrietada. */
  BROKEN = 'B',
}
