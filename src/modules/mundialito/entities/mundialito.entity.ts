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

/** La pantalla completa del mundialito. */
export class MundialitoBoard {
  medalWinners!: MundialitoMedal[];
  board!: MundialitoBoardEntry[];
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
}

/** Todo lo que el perfil necesita del mundialito. */
export class PlayerMundialito {
  summary!: MundialitoSummary;
  /** null si el jugador todavia no jugo ningun partido elegible. */
  current!: MundialitoRun | null;
  eliminationsByPhase!: MundialitoPhaseEliminations[];
}
