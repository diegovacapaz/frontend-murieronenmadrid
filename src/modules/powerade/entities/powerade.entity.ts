/** Un puesto de una versión del ranking, con el jugador ya resuelto. */
export interface EntradaRanking {
  position: number;
  playerId: number;
  displayName: string;
  photo: string | null;
  cups: number;
  /** La frase de por qué ese puesto. */
  reason: string;
}

/** Una versión del ranking de un torneo. */
export interface VersionRanking {
  rankingId: number;
  tournamentId: number;
  version: number;
  /** El `MAX(matchId)` del torneo que el redactor tuvo delante. */
  lastMatchId: number;
  /** Sube en cada reemplazo: es lo que detecta una publicación concurrente. */
  revision: number;
  /** ISO, con sufijo Z, como el resto de la API. */
  publishedAt: string;
  entries: EntradaRanking[];
}

export type TipoMovimiento = 'sube' | 'baja' | 'igual' | 'entra';

/** Cómo se movió un jugador respecto de la versión anterior. */
export interface Movimiento {
  tipo: TipoMovimiento;
  /** Cuántos lugares; 0 para `igual` y `entra`. */
  lugares: number;
}

/**
 * La versión vigente sobre la que se escribió un borrador, o `null` si todavía no
 * había ninguna. Al publicar se vuelve a leer la vigente y se compara contra esto.
 */
export type BaseDelBorrador = {
  rankingId: number;
  version: number;
  lastMatchId: number;
  revision: number;
} | null;
