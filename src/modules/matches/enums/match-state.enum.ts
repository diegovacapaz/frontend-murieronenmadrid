/**
 * Estado de un partido.
 *
 * Solo los jugados cuentan para algo: tablas, logros, mundialito, diario. Los
 * otros dos existen para organizar el partido antes de jugarlo.
 */
export enum MatchState {
  /** En preparacion: convocados, quizas sin equipo; total impar permitido. */
  PREPARING = 'P',
  /** Listo: equipos completos y parejos, sin resultado. */
  READY = 'R',
  /** Jugado: con resultado. */
  PLAYED = 'J',
}
