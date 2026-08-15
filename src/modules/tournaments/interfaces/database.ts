import type { Row } from '../../../database/database.types';
import type { TournamentState } from '../enums/tournament-state.enum';

export interface TournamentFields {
  tournamentId: number;
  name: string;
  startedAt: Date;
  endedAt: Date;
  state: TournamentState;
  wasTracked: boolean;
  winningPoints: number;
  lossingPoints: number;
  drawingPoints: number;
  createdAt: Date;
  matchesCount: number;
  derbiesCount: number;
  playersCount: number;
  penaltiesCount: number;
  championPlayerId: number | null;
  championName: string | null;
}

export interface TournamentDB extends Row, TournamentFields {}
