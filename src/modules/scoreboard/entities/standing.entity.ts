import { EntityState } from '../../../common/enums/entity-state.enum';
import { PlayerChampionship } from '../../players/entities/player.entity';

/**
 * Una fila de tabla de posiciones.
 *
 * Todo lo de aca lo calcula la base (vTournamentStandings / vGeneralStandings),
 * incluida la posicion: el frontend recibe las filas en orden y solo las pinta.
 * El desempate oficial —puntos netos, diferencia de gol, winrate— vive en una
 * sola vista y ningun cliente lo reimplementa.
 */
export class Standing {
  position!: number;
  playerId!: number;
  displayName!: string;
  nickname!: string | null;
  photo!: string | null;
  playerState!: EntityState;
  isSagrado!: boolean;
  cups!: number;

  played!: number;
  won!: number;
  drew!: number;
  lost!: number;
  goalsDiference!: number;

  /** Puntos brutos, segun la puntuacion del torneo. */
  points!: number;
  /** Techo posible: como si hubiera ganado todos los que jugo. */
  maxPoints!: number;
  /**
   * points / maxPoints. Es rendimiento sobre puntos posibles, NO porcentaje de
   * partidos ganados: en un torneo que paga por perder, quien pierde todo no
   * queda en cero. Asi lo calculaba el sistema original.
   */
  winRate!: number | null;
  penalty!: number;
  /** points - penalty. Es la columna que define al campeon. */
  netPoints!: number;
}

/** La fila de la tabla historica suma dos datos que solo tienen sentido ahi. */
export class GeneralStanding extends Standing {
  tournamentsPlayed!: number;
  championships!: PlayerChampionship[];
}
