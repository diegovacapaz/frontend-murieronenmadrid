import { EntityState } from '../../../common/enums/entity-state.enum';
import { MatchResult } from '../../matches/enums/match-result.enum';
import { MundialitoPhase, MundialitoStatus } from '../enums/mundialito.enums';

/**
 * Un partido dentro de un mundialito: una de las ocho pelotas de la card.
 *
 * `slot` es el puesto que ocupa (1 a 8) y `phase` la fase que le corresponde.
 * Van los dos porque el frontend necesita el puesto para ordenar y la fase para
 * etiquetar, y derivar una de la otra en el cliente seria repetir la regla.
 */
export class MundialitoBall {
  slot!: number;
  phase!: MundialitoPhase;
  result!: MatchResult;
  /** Puntos del mundialito: 3, 1 o 0. No depende de la puntuacion del torneo. */
  points!: number;
  matchId!: number;
}

/**
 * El mundialito vigente de un jugador.
 *
 * Vigente no quiere decir abierto: un jugador eliminado sigue mostrando la
 * corrida que acaba de perder —con su pelota roja— hasta que juegue otro
 * partido y arranque la siguiente. Lo mismo el campeon.
 */
export class MundialitoRun {
  playerId!: number;
  /** Numero de mundialito del jugador: el primero es 1. */
  runIndex!: number;
  /** Partidos jugados de los ocho. */
  played!: number;
  /** Puntos sumados en la fase de grupos. Se congela al clasificar. */
  groupPoints!: number;
  status!: MundialitoStatus;
  /** Fase del ultimo partido jugado. */
  phase!: MundialitoPhase;
  /** Puesto que va a ocupar el proximo partido; 1 si la corrida ya cerro. */
  nextSlot!: number;
  lastPlayedAt!: Date;
  balls!: MundialitoBall[];
}

/** Datos del jugador que acompañan a toda fila de estas pantallas. */
export class MundialitoPlayer {
  playerId!: number;
  displayName!: string;
  nickname!: string | null;
  photo!: string | null;
  playerState!: EntityState;
  isSagrado!: boolean;
  /** Torneos ganados: las estrellas. El mundialito NO suma acá. */
  cups!: number;
}

/** Una fila del medallero: quienes ganaron algun mundialito. */
export class MundialitoMedal extends MundialitoPlayer {
  position!: number;
  titles!: number;
  /** Desempate del medallero: primero el que lo consiguio antes. */
  firstTitleAt!: Date;
  lastTitleAt!: Date;
}

/** Una fila del tablero: el jugador con su mundialito vigente. */
export class MundialitoBoardEntry extends MundialitoPlayer {
  titles!: number;
  run!: MundialitoRun;
}

/** Los números del mundialito entero. */
export class MundialitoGlobalSummary {
  /** Corridas terminadas. La que se está jugando no cuenta. */
  runsEnded!: number;
  titles!: number;
  /** titles / runsEnded. Ganar un mundialito es raro y este número lo dice. */
  coronationRate!: number | null;
  qualified!: number;
  qualifiedRate!: number | null;
  avgRunLength!: number | null;
  /** Jugadores con al menos una corrida terminada. */
  players!: number;
  aliveNow!: number;
  /** De los vivos, cuántos ya están en eliminación directa. */
  inKnockoutNow!: number;
  perfectRuns!: number;
}

/** Una fila de la tabla de rendimiento histórico. */
export class MundialitoPerformance extends MundialitoPlayer {
  position!: number;
  runsPlayed!: number;
  runsEnded!: number;
  qualified!: number;
  /** null cuando no terminó ninguna corrida: no hay porcentaje que calcular. */
  qualifiedRate!: number | null;
  avgRunLength!: number | null;
  koPlayed!: number;
  koPassed!: number;
  koRate!: number | null;
  semis!: number;
  finals!: number;
  titles!: number;
  bestSlot!: number;
  /** Corridas terminadas seguidas sin pasar de grupos. */
  droughtRuns!: number;
}

export const MundialitoRecordKind = {
  /** Ocho partidos, ocho victorias. */
  PERFECT_RUN: 'PERFECT_RUN',
  /** El que más lejos llegó sin dar nunca la vuelta. */
  ETERNAL_CANDIDATE: 'ETERNAL_CANDIDATE',
} as const;
export type MundialitoRecordKind =
  (typeof MundialitoRecordKind)[keyof typeof MundialitoRecordKind];

export class MundialitoRecord {
  kind!: MundialitoRecordKind;
  playerId!: number;
  displayName!: string;
  photo!: string | null;
  value!: number;
}

/** La pantalla completa del mundialito. */
export class MundialitoBoard {
  medalWinners!: MundialitoMedal[];
  board!: MundialitoBoardEntry[];
  summary!: MundialitoGlobalSummary;
  performance!: MundialitoPerformance[];
  /** El cementerio: en qué fase se muere el grupo entero. */
  eliminationsByPhase!: MundialitoPhaseEliminations[];
  records!: MundialitoRecord[];
}

/** Cuantas veces se murio un jugador en cada fase. */
export class MundialitoPhaseEliminations {
  slot!: number;
  phase!: MundialitoPhase;
  eliminations!: number;
}

/** El resumen historico de un jugador en el mundialito. */
export class MundialitoSummary {
  playerId!: number;
  /** Partidos elegibles: los de torneos de los que se guardo el detalle. */
  matchesPlayed!: number;
  /** Mundialitos corridos, incluido el vigente. */
  runsPlayed!: number;
  titles!: number;
  eliminations!: number;
  /** Puesto mas alto que jugo alguna vez. 8 significa que jugo una final. */
  bestSlot!: number;

  /** Corridas terminadas. Es el denominador de los porcentajes de abajo. */
  runsEnded!: number;
  qualified!: number;
  qualifiedRate!: number | null;
  avgRunLength!: number | null;
  koPlayed!: number;
  koPassed!: number;
  koRate!: number | null;
  semis!: number;
  finals!: number;
  /** Corridas terminadas seguidas sin pasar de grupos. */
  droughtRuns!: number;
  perfectRuns!: number;
}

export const MundialitoHighlightKind = {
  /** El que más veces estaba enfrente cuando este jugador quedó afuera. */
  NEMESIS: 'NEMESIS',
  /** A quien dejó afuera más veces. */
  VICTIM: 'VICTIM',
} as const;
export type MundialitoHighlightKind =
  (typeof MundialitoHighlightKind)[keyof typeof MundialitoHighlightKind];

/**
 * Verdugo y víctima del mundialito.
 *
 * Ojo con leerlo como un duelo: acá no se pierde contra una persona sino contra
 * un equipo, así que `times` es "estaba del otro lado", no "te ganó él".
 * `played` son los cruces totales, para que el número se pueda leer sobre algo.
 */
export class MundialitoHighlight {
  kind!: MundialitoHighlightKind;
  playerId!: number;
  displayName!: string;
  photo!: string | null;
  times!: number;
  played!: number;
}

/** Todo lo que el perfil necesita del mundialito. */
export class PlayerMundialito {
  summary!: MundialitoSummary;
  /** null si el jugador todavia no jugo ningun partido elegible. */
  current!: MundialitoRun | null;
  eliminationsByPhase!: MundialitoPhaseEliminations[];
  /** Cero, una o dos filas: no siempre hay rival que supere el mínimo. */
  highlights!: MundialitoHighlight[];
}
