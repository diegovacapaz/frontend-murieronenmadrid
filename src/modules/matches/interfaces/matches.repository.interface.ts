import type { Team } from '../../teams/enums/team.enum';
import type { Match } from '../entities/match.entity';

/**
 * Las notas del administrador viajan como parametro propio y NO como campo de
 * `Partial<Match>`, por la misma razon que la convocatoria: no son parte de lo
 * que se lee de un partido. `GetMatchById` es publico y no las devuelve, asi
 * que ponerlas en la entidad seria declarar un campo que la factory nunca
 * completa.
 */

/** Una linea de la convocatoria: quien y en que equipo (null en preparacion). */
export interface MatchLineupEntry {
  playerId: number;
  team: Team | null;
}

/** Un random al cargar o editar: por nombre. */
export interface MatchGuestEntry {
  name: string;
  team: Team | null;
}

/** Un random al armar equipos: por id, porque ya existe. */
export interface GuestTeamEntry {
  guestId: number;
  team: Team;
}

export interface SearchMatchesParams {
  tournamentId?: number;
  isDerby?: boolean;
  playerId?: number;
  /** Incluir partidos en preparacion. El service solo lo pasa para admins. */
  includePending?: boolean;
}

export interface FinishMatchParams {
  winnerTeam: Team | null;
  goalsDiference: number;
  notes: string | null;
}

export interface IMatchesRepository {
  search(params: SearchMatchesParams): Promise<Match[]>;
  findById(matchId: number): Promise<Match | null>;
  /** Listos y en preparacion con team maker activo, del mas cercano al mas lejano. */
  findUpcoming(): Promise<Match[]>;
  create(
    match: Partial<Match>,
    lineup: MatchLineupEntry[],
    guests: MatchGuestEntry[],
    notes: string | null,
  ): Promise<Match>;
  update(
    matchId: number,
    match: Partial<Match>,
    lineup: MatchLineupEntry[],
    guests: MatchGuestEntry[],
    notes: string | null,
  ): Promise<Match>;
  /** En preparacion -> listo. */
  setTeams(matchId: number, lineup: MatchLineupEntry[], guests: GuestTeamEntry[]): Promise<Match>;
  /** Listo -> en preparacion. */
  clearTeams(matchId: number): Promise<Match>;
  /** Listo -> jugado. */
  finish(matchId: number, params: FinishMatchParams): Promise<Match>;
  remove(matchId: number): Promise<Match>;
  /** Canchas distintas ya usadas, de mas a menos frecuente. */
  findPlaces(): Promise<string[]>;
  /** Las notas del administrador. Cadena vacia si el partido no tiene. */
  findNotes(matchId: number): Promise<string>;
}
