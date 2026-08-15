/**
 * Las ocho fechas de un mundialito. Los tres primeros partidos son la fase de
 * grupos y los cinco siguientes, eliminacion directa.
 *
 * No se guardan en ninguna columna: los deduce vMundialitoRuns a partir del
 * puesto que ocupa cada partido dentro de la corrida.
 */
export enum MundialitoPhase {
  GROUP = 'GROUP',
  ROUND_16 = 'R16',
  ROUND_8 = 'R8',
  ROUND_4 = 'R4',
  SEMI = 'SF',
  FINAL = 'F',
}

/** Como quedo una corrida despues de su ultimo partido. */
export enum MundialitoStatus {
  /** Sigue en carrera: le quedan partidos por jugar en este mundialito. */
  ALIVE = 'ALIVE',
  /** Quedo afuera. El proximo partido que juegue arranca uno nuevo. */
  OUT = 'OUT',
  /** Dio la vuelta. El proximo partido que juegue arranca uno nuevo. */
  CHAMPION = 'CHAMPION',
}

/** Partidos que dura un mundialito: 3 de grupos + 5 de eliminacion directa. */
export const MUNDIALITO_SLOTS = 8;

/** Puntos que hay que sumar en los tres partidos de grupos para clasificar. */
export const MUNDIALITO_GROUP_TARGET = 4;
