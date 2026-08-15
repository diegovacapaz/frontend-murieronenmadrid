import { Team } from '../../teams/enums/team.enum';

/** Un jugador dentro de la convocatoria, con lo justo para pintarlo. */
export class MatchPlayer {
  playerId!: number;
  team!: Team;
  firstName!: string;
  secondName!: string;
  nickname!: string | null;
  displayName!: string;
  photo!: string | null;
}

/**
 * Modelo de dominio de un partido.
 *
 * `winnerTeam` en null significa empate, y en ese caso `goalsDiference` es 0:
 * el margen se guarda SIN signo y de que lado cae lo dice el ganador. Esa
 * decision es del modelo relacional y evita el clasico problema de un "-3" que
 * nadie sabe respecto de quien.
 */
export class Match {
  matchId!: number;
  tournamentId!: number;
  tournamentName!: string;
  winnerTeam!: Team | null;
  goalsDiference!: number;
  place!: string;
  playedAt!: Date;
  isDerby!: boolean;
  players!: MatchPlayer[];

  isDraw(): boolean {
    return this.winnerTeam === null;
  }
}
