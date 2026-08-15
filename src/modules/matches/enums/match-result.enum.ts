/**
 * Resultado de un partido visto desde un jugador. Lo calcula la vista
 * vMatchPlayerResults cruzando el equipo del jugador con el ganador del partido;
 * no se guarda en ninguna columna.
 */
export enum MatchResult {
  WIN = 'W',
  DRAW = 'D',
  LOSS = 'L',
}
