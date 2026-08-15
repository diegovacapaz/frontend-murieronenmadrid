import type { Row } from '../../../database/database.types';
import type { TournamentState } from '../../tournaments/enums/tournament-state.enum';

export interface PenaltyFields {
  playerId: number;
  tournamentId: number;
  penalty: number;
  playerName: string;
  playerPhoto: string | null;
  tournamentName: string;
  tournamentState: TournamentState;
}

export interface PenaltyDB extends Row, PenaltyFields {}
