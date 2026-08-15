import { TournamentState } from '../../tournaments/enums/tournament-state.enum';

/**
 * Penalizacion de un jugador en un torneo.
 *
 * Es UNA fila por (jugador, torneo) con el acumulado, no un historial de
 * sanciones: asi lo modela el diagrama y asi se usaba en el sistema original,
 * donde era un numero que se restaba en la tabla.
 *
 * Se resta de los puntos pero NO afecta el winrate: castiga la tabla, no el
 * rendimiento deportivo.
 */
export class Penalty {
  playerId!: number;
  tournamentId!: number;
  penalty!: number;
  playerName!: string;
  playerPhoto!: string | null;
  tournamentName!: string;
  tournamentState!: TournamentState;
}
