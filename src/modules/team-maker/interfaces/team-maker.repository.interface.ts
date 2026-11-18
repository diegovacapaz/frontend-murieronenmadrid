import type { MakerStatus, PickEntry, PickRef, PoolEntry, Seat } from '../team-maker.types';

/** Un lugar de capitan tal como esta guardado. */
export interface SeatRecord {
  playerId: number | null;
  name: string | null;
  photo: string | null;
  tokenHash: string | null;
  vote: string | null;
}

/**
 * Lo que la base sabe de un maker: alcanza para rearmar el estado en vivo si
 * la API se reinicia. Lo que es solo de la sesion (sockets, viewers, quien
 * esta conectado) vive en memoria en el service.
 */
export interface TeamMakerRecord {
  makerId: number;
  matchId: number;
  tournamentId: number;
  isDerby: boolean;
  status: MakerStatus;
  captainCode: string;
  firstSeat: Seat | null;
  firstByDraw: boolean;
  coinWinner: Seat | null;
  seats: [SeatRecord, SeatRecord];
  picks: PickEntry[];
  /** Toda la convocatoria: jugadores reales y randoms. */
  roster: PoolEntry[];
}

export interface ITeamMakerRepository {
  create(matchId: number, captainCode: string): Promise<{ makerId: number; captainCode: string }>;
  /** El maker activo del partido o, si no hay, el ultimo. */
  findByMatch(matchId: number): Promise<TeamMakerRecord | null>;
  claimSeat(makerId: number, seat: Seat, playerId: number, tokenHash: string): Promise<void>;
  /** Posicion (RANK) de cada capitan en la tabla del torneo; null si no jugo. */
  captainPositions(matchId: number, playerIds: [number, number]): Promise<[number | null, number | null]>;
  startPicking(makerId: number, firstSeat: Seat, byDraw: boolean): Promise<void>;
  addPick(makerId: number, turn: number, seat: Seat, ref: PickRef, isLast: boolean): Promise<void>;
  setVote(makerId: number, seat: Seat, vote: string): Promise<void>;
  finish(makerId: number, colors: [string, string], coinWinner: Seat | null): Promise<void>;
  cancel(makerId: number): Promise<void>;
  restart(makerId: number, captainCode: string): Promise<void>;
}
