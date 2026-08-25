/**
 * Eventos que la API emite por websocket.
 *
 * Contrato con el frontend: el nombre es `<entidad>:<accion>` y el payload es
 * la entidad afectada, ya en el mismo shape que devuelve el endpoint REST
 * correspondiente. Un store puede aplicar el cambio sin volver a pedir nada.
 *
 * SCOREBOARD_INVALIDATED es distinto: no lleva datos sino un aviso de que las
 * tablas cambiaron. Recalcular una tabla es trabajo de la base (depende de
 * puntos, penalizaciones y desempates), asi que mandarla entera por socket seria
 * pesado y quedaria desincronizada del criterio de orden. El frontend recibe el
 * aviso y refetchea solo la tabla que esta mirando.
 */
export enum RealtimeEvent {
  PLAYER_CREATED = 'player:created',
  PLAYER_UPDATED = 'player:updated',
  PLAYER_DELETED = 'player:deleted',

  TOURNAMENT_CREATED = 'tournament:created',
  TOURNAMENT_UPDATED = 'tournament:updated',
  TOURNAMENT_DELETED = 'tournament:deleted',

  MATCH_CREATED = 'match:created',
  MATCH_UPDATED = 'match:updated',
  MATCH_DELETED = 'match:deleted',

  PENALTY_CREATED = 'penalty:created',
  PENALTY_UPDATED = 'penalty:updated',
  PENALTY_DELETED = 'penalty:deleted',

  /** Las tablas de posiciones quedaron viejas. Payload: { tournamentId | null }. */
  SCOREBOARD_INVALIDATED = 'scoreboard:invalidated',

  /**
   * Salio una edicion nueva del diario. Payload: { publishedOn }.
   *
   * No lleva las notas: a las cinco de la manana no hay nadie mirando, y quien
   * tenga la app abierta va a refetchear igual. Mandar la edicion entera por
   * socket seria pesado para un caso que casi no ocurre.
   */
  NEWSLETTER_PUBLISHED = 'newsletter:published',
}

/** Payload de SCOREBOARD_INVALIDATED. */
export interface ScoreboardInvalidatedPayload {
  /**
   * Torneo afectado, o null cuando el cambio pega en todos (por ejemplo, borrar
   * un jugador). La tabla historica siempre queda invalidada.
   */
  tournamentId: number | null;
}
