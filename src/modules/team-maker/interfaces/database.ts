import type { Row } from '../../../database/database.types';
import type { MakerStatus } from '../team-maker.types';

/** Primer result set de GetTeamMakerByMatch. */
export interface TeamMakerDB extends Row {
  makerId: number;
  matchId: number;
  tournamentId: number;
  isDerby: boolean;
  state: MakerStatus;
  captainCode: string;
  firstSeat: number | null;
  firstByDraw: boolean;
  coinWinner: number | null;
}

export interface TeamMakerSeatDB extends Row {
  seat: number;
  playerId: number | null;
  tokenHash: string | null;
  vote: string | null;
  name: string | null;
  photo: string | null;
}

export interface TeamMakerPickDB extends Row {
  turn: number;
  seat: number;
  playerId: number | null;
  guestId: number | null;
}

/** La convocatoria: jugadores reales (P) y randoms (G). */
export interface TeamMakerRosterDB extends Row {
  kind: 'P' | 'G';
  id: number;
  name: string;
  photo: string | null;
}

export interface CreatedTeamMakerDB extends Row {
  makerId: number;
  captainCode: string;
}

export interface CaptainPositionsDB extends Row {
  pos0: number | null;
  pos1: number | null;
}
