import type { Team } from '../../teams/enums/team.enum';
import type { Match } from '../entities/match.entity';

/** Una linea de la convocatoria: quien y en que equipo. */
export interface MatchLineupEntry {
  playerId: number;
  team: Team;
}

export interface SearchMatchesParams {
  tournamentId?: number;
  isDerby?: boolean;
  playerId?: number;
}

export interface IMatchesRepository {
  search(params: SearchMatchesParams): Promise<Match[]>;
  findById(matchId: number): Promise<Match | null>;
  create(match: Partial<Match>, lineup: MatchLineupEntry[]): Promise<Match>;
  update(
    matchId: number,
    match: Partial<Match>,
    lineup: MatchLineupEntry[],
  ): Promise<Match>;
  remove(matchId: number): Promise<Match>;
  /** Canchas distintas ya usadas, de mas a menos frecuente. */
  findPlaces(): Promise<string[]>;
}
