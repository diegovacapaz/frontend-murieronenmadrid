/**
 * Tipos del team maker compartidos entre reglas, service, gateway y el estado
 * que viaja a los clientes.
 */

/** Uno de los dos lugares de capitan. */
export type Seat = 0 | 1;

/** Una eleccion: un jugador real (P) o un random (G). */
export type PickRef = { kind: 'P'; id: number } | { kind: 'G'; id: number };

/**
 * W esperando capitanes · K eligiendo · V votando color · F terminado ·
 * C cancelado.
 */
export type MakerStatus = 'W' | 'K' | 'V' | 'F' | 'C';

export interface SeatState {
  playerId: number | null;
  name: string | null;
  photo: string | null;
  connected: boolean;
  /** Si ya voto color. El voto en si no viaja hasta que votan los dos. */
  voted: boolean;
}

export interface PoolEntry {
  ref: PickRef;
  name: string;
  photo: string | null;
}

export interface PickEntry {
  turn: number;
  seat: Seat;
  ref: PickRef;
}

/** El estado completo que reciben los clientes en cada cambio. */
export interface TeamMakerState {
  makerId: number;
  matchId: number;
  isDerby: boolean;
  status: MakerStatus;
  seats: [SeatState, SeatState];
  /** Jugadores reales convocados: los que se pueden marcar como capitan. */
  candidates: PoolEntry[];
  firstSeat: Seat | null;
  firstByDraw: boolean;
  /** De quien es cada turno, en orden. */
  order: Seat[];
  /** Indice en `order` del turno actual. */
  turn: number;
  /** Los que todavia no fueron elegidos (sin los capitanes). */
  pool: PoolEntry[];
  picks: PickEntry[];
  /** Color de cada lugar una vez resuelta la votacion. */
  colors: [string, string] | null;
  coinWinner: Seat | null;
  viewers: number;
  /** Falta un capitan: nadie elige ni vota hasta que vuelva. */
  paused: boolean;
}

export type PickError = 'NOT_PICKING' | 'PAUSED' | 'WRONG_TURN' | 'NOT_YOUR_TURN' | 'NOT_IN_POOL';
