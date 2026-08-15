import type { Tournament } from '../entities/tournament.entity';
import type { TournamentState } from '../enums/tournament-state.enum';

export interface SearchTournamentsParams {
  state?: TournamentState;
  wasTracked?: boolean;
}

export interface ITournamentsRepository {
  search(params: SearchTournamentsParams): Promise<Tournament[]>;
  findById(tournamentId: number): Promise<Tournament | null>;
  create(tournament: Partial<Tournament>): Promise<Tournament>;
  update(tournamentId: number, tournament: Partial<Tournament>): Promise<Tournament>;
  setState(tournamentId: number, state: TournamentState): Promise<Tournament>;
  remove(tournamentId: number): Promise<Tournament>;
}
