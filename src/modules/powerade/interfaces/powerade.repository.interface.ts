import type { VersionRanking } from '../entities/powerade.entity';

/** Lo que se necesita saber de un torneo para decidir si puede tener ranking. */
export interface TorneoParaRanking {
  tournamentId: number;
  name: string;
  state: 'P' | 'F';
  wasTracked: boolean;
}

/** Lo que se guarda al publicar. La posición de cada entrada es su índice + 1. */
export interface DatosRanking {
  tournamentId: number;
  lastMatchId: number;
  model: string;
  entradas: Array<{ playerId: number; reason: string }>;
}

export interface IPoweradeRepository {
  /** El torneo, o null si no existe. */
  findTournament(tournamentId: number): Promise<TorneoParaRanking | null>;

  /**
   * El torneo en juego (`state = 'P'`) con detalle (`wasTracked`) de `startedAt`
   * más reciente; el id desempata. null si no hay ninguno.
   */
  findPlayingTournamentId(): Promise<number | null>;

  /**
   * Las últimas `cantidad` versiones del torneo, de la más nueva a la más vieja,
   * con sus entradas (nombre, foto y copas salen de `vPlayerDetail`).
   */
  findLatestVersions(tournamentId: number, cantidad: number): Promise<VersionRanking[]>;

  /** Los jugadores que jugaron al menos un partido del torneo. */
  findParticipants(
    tournamentId: number,
  ): Promise<Array<{ playerId: number; displayName: string; partidos: number }>>;

  /** El `MAX(matchId)` del torneo, o null si todavía no tiene partidos. */
  findMaxMatchId(tournamentId: number): Promise<number | null>;

  /** Cuántos partidos del torneo son `<= lastMatchId` (contados) y cuántos `>` (nuevos). */
  countMatches(
    tournamentId: number,
    lastMatchId: number,
  ): Promise<{ contados: number; nuevos: number }>;

  /** Las filas de `GetTournamentScoreboard`, tal cual: la tabla que ve la solapa Tabla. */
  findTournamentTable(tournamentId: number): Promise<unknown[]>;

  /**
   * Guarda una versión NUEVA: `version = MAX(version) + 1` del torneo, con sus
   * tres entradas, en una transacción.
   *
   * **Comprueba la base ADENTRO de la transacción**: `base` es la versión vigente
   * sobre la que se escribió el borrador (o `null` si no había ninguna), y si la
   * vigente de ahora no es exactamente esa lanza `PoweradeConflictoError` sin
   * escribir nada. Sin esto dos inserciones simultáneas crearían dos versiones
   * (N+1 y N+2): el `UNIQUE (tournamentId, version)` no las frena porque los
   * números son distintos, y la lectura de afuera de la transacción no alcanza.
   */
  insertRanking(
    datos: DatosRanking,
    base: { rankingId: number; revision: number } | null,
  ): Promise<VersionRanking>;

  /**
   * Reescribe una versión existente conservando su número y subiendo su
   * `revision`, en una transacción. El `UPDATE` está condicionado a la
   * `revision` de `base`: si ya no coincide, alguien publicó en el medio y
   * lanza `PoweradeConflictoError` sin tocar nada.
   */
  replaceRanking(
    base: { rankingId: number; revision: number },
    datos: DatosRanking,
  ): Promise<VersionRanking>;
}
