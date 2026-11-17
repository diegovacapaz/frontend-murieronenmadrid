import type { Row } from '../../../database/database.types';
import type { Team } from '../../teams/enums/team.enum';
import type { MatchGuest, MatchPlayer } from '../entities/match.entity';
import type { MatchState } from '../enums/match-state.enum';

export interface MatchFields {
  matchId: number;
  tournamentId: number;
  tournamentName: string;
  winnerTeam: Team | null;
  goalsDiference: number;
  place: string;
  playedAt: Date;
  isDerby: boolean;
  state: MatchState;
  /** Columna JSON armada por vMatchDetail; el typeCast del pool ya la parsea. */
  players: MatchPlayer[];
  /** JSON de vMatchDetail. Puede llegar como string si el driver no lo parsea. */
  guests?: MatchGuest[] | string | null;
}

export interface MatchDB extends Row, MatchFields {}

/** Fila de SearchPlaces: una cancha y cuantas veces se jugo en ella. */
export interface PlaceFields {
  place: string;
  matches: number;
}

export interface PlaceDB extends Row, PlaceFields {}

/** Shape de la fila devuelta por GetMatchNotes. */
export interface MatchNotesDB extends Row {
  notes: string;
}
