import { TournamentState } from '../enums/tournament-state.enum';

/**
 * Modelo de dominio de un torneo.
 *
 * Los tres campos de puntuacion son propios de cada torneo, no constantes del
 * sistema: la Apertura 2025 pagaba 1 punto por perder y la Clausura 2025 paga
 * 0.25. Toda tabla se calcula con la puntuacion de SU torneo.
 *
 * Los contadores y el campeon son calculados (vTournamentDetail), no columnas.
 */
export class Tournament {
  tournamentId!: number;
  name!: string;
  startedAt!: Date;
  endedAt!: Date;
  state!: TournamentState;
  /**
   * false para los torneos de los que solo sobrevivio la tabla final: sus
   * partidos existen para reproducirla, pero no tienen marcadores reales y el
   * frontend no los muestra.
   */
  wasTracked!: boolean;
  winningPoints!: number;
  lossingPoints!: number;
  drawingPoints!: number;
  createdAt!: Date;

  matchesCount!: number;
  derbiesCount!: number;
  playersCount!: number;
  penaltiesCount!: number;
  championPlayerId!: number | null;
  championName!: string | null;

  isPlaying(): boolean {
    return this.state === TournamentState.PLAYING;
  }
}
