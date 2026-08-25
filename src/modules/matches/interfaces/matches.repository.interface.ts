import type { Team } from '../../teams/enums/team.enum';
import type { Match } from '../entities/match.entity';

/**
 * Las notas del administrador viajan como parametro propio y NO como campo de
 * `Partial<Match>`, por la misma razon que la convocatoria: no son parte de lo
 * que se lee de un partido. `GetMatchById` es publico y no las devuelve, asi
 * que ponerlas en la entidad seria declarar un campo que la factory nunca
 * completa.
 */

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
  create(
    match: Partial<Match>,
    lineup: MatchLineupEntry[],
    notes: string | null,
  ): Promise<Match>;
  update(
    matchId: number,
    match: Partial<Match>,
    lineup: MatchLineupEntry[],
    notes: string | null,
  ): Promise<Match>;
  remove(matchId: number): Promise<Match>;
  /** Canchas distintas ya usadas, de mas a menos frecuente. */
  findPlaces(): Promise<string[]>;
  /** Las notas del administrador. Cadena vacia si el partido no tiene. */
  findNotes(matchId: number): Promise<string>;
}
