import type { Row } from '../../../database/database.types';
import type { Team } from '../../teams/enums/team.enum';
import type { MatchPlayer } from '../entities/match.entity';

export interface MatchFields {
  matchId: number;
  tournamentId: number;
  tournamentName: string;
  winnerTeam: Team | null;
  goalsDiference: number;
  place: string;
  playedAt: Date;
  isDerby: boolean;
  /** Columna JSON armada por vMatchDetail; el typeCast del pool ya la parsea. */
  players: MatchPlayer[];
}

export interface MatchDB extends Row, MatchFields {}

/** Fila de SearchPlaces: una cancha y cuantas veces se jugo en ella. */
export interface PlaceFields {
  place: string;
  matches: number;
}

export interface PlaceDB extends Row, PlaceFields {}
