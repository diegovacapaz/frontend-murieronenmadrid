import { Injectable } from '@nestjs/common';
import { RealtimeEvent, ScoreboardInvalidatedPayload } from './realtime.events';
import { RealtimeGateway } from './realtime.gateway';

/**
 * Lo que los services de dominio usan para avisar que algo cambio.
 *
 * Existe para que un service no dependa del gateway ni de socket.io: pide
 * "notifica esto" y no sabe si abajo hay websockets, SSE o nada. Cambiar el
 * transporte es tocar un archivo.
 */
@Injectable()
export class RealtimeService {
  constructor(private readonly gateway: RealtimeGateway) {}

  /** Notifica un cambio de entidad con su payload ya en shape de respuesta. */
  emit(event: RealtimeEvent, payload: unknown): void {
    this.gateway.broadcast(event, payload);
  }

  /**
   * Avisa que las tablas de posiciones quedaron viejas.
   *
   * `tournamentId` acota el impacto para que el frontend refetchee solo lo que
   * esta mirando; la tabla historica se invalida siempre, porque cualquier
   * cambio de partido o penalizacion la mueve.
   */
  invalidateScoreboard(tournamentId: number | null): void {
    const payload: ScoreboardInvalidatedPayload = { tournamentId };
    this.gateway.broadcast(RealtimeEvent.SCOREBOARD_INVALIDATED, payload);
  }
}
