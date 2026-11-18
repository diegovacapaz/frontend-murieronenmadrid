import { HttpException, Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { Namespace, Socket } from 'socket.io';
import { TeamMakerError, TeamMakerService } from './team-maker.service';
import type { PickRef } from './team-maker.types';

type Ack = { ok: true; [key: string]: unknown } | { ok: false; error: string };

const room = (matchId: number) => `mk:${matchId}`;

const isRef = (value: unknown): value is PickRef =>
  typeof value === 'object' &&
  value !== null &&
  ((value as PickRef).kind === 'P' || (value as PickRef).kind === 'G') &&
  Number.isInteger((value as PickRef).id);

/**
 * El canal en vivo del team maker, en un namespace propio.
 *
 * A diferencia del gateway general (de un solo sentido, sin comandos), aca SI
 * entran acciones: ocupar el lugar de capitan es lo mismo que estar conectado,
 * asi que el capitan elige por el mismo socket que avisa cuando se cae. Lo que
 * entra no son escrituras de admin (esas siguen por HTTP con el AdminGuard):
 * es marcarse capitan con el codigo del link, elegir, votar y reaccionar, y
 * cada cosa la valida el service.
 *
 * Cada mensaje responde con un ack `{ ok, ... }`. El gateway solo traduce
 * eventos a llamadas del service.
 */
@WebSocketGateway({
  namespace: '/team-maker',
  cors: { origin: true, credentials: true },
  transports: ['websocket', 'polling'],
})
export class TeamMakerGateway implements OnGatewayInit, OnGatewayDisconnect {
  private readonly logger = new Logger(TeamMakerGateway.name);

  constructor(private readonly service: TeamMakerService) {}

  afterInit(namespace: Namespace): void {
    this.service.attachRoom(
      (matchId, event, payload) => {
        namespace.to(room(matchId)).emit(event, payload);
      },
      (socketId) => {
        const socket = namespace.sockets.get(socketId);
        socket?.emit('tm:replaced');
        socket?.disconnect(true);
      },
    );
  }

  handleDisconnect(client: Socket): void {
    this.service.leave(client.id);
  }

  @SubscribeMessage('tm:join')
  join(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { matchId?: unknown; code?: unknown; seatToken?: unknown; nick?: unknown },
  ): Promise<Ack> {
    return this.run(async () => {
      const matchId = Number(body?.matchId);
      if (!Number.isInteger(matchId) || matchId < 1) throw new TeamMakerError('INVALID');
      const result = await this.service.join(client.id, matchId, {
        code: typeof body.code === 'string' ? body.code : undefined,
        seatToken: typeof body.seatToken === 'string' ? body.seatToken : undefined,
        nick: typeof body.nick === 'string' ? body.nick : undefined,
      });
      await client.join(room(matchId));
      return { seat: result.seat, state: result.state };
    });
  }

  @SubscribeMessage('tm:claim')
  claim(@ConnectedSocket() client: Socket, @MessageBody() body: { playerId?: unknown }): Promise<Ack> {
    return this.run(async () => {
      const playerId = Number(body?.playerId);
      if (!Number.isInteger(playerId)) throw new TeamMakerError('INVALID');
      return this.service.claim(client.id, playerId);
    });
  }

  @SubscribeMessage('tm:aim')
  aim(@ConnectedSocket() client: Socket, @MessageBody() body: { ref?: unknown }): Promise<Ack> {
    return this.run(() => {
      this.service.aim(client.id, isRef(body?.ref) ? body.ref : null);
      return {};
    });
  }

  @SubscribeMessage('tm:pick')
  pick(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { expectedTurn?: unknown; ref?: unknown },
  ): Promise<Ack> {
    return this.run(async () => {
      if (!Number.isInteger(body?.expectedTurn) || !isRef(body?.ref)) throw new TeamMakerError('INVALID');
      await this.service.pick(client.id, body.expectedTurn as number, body.ref);
      return {};
    });
  }

  @SubscribeMessage('tm:vote')
  vote(@ConnectedSocket() client: Socket, @MessageBody() body: { color?: unknown }): Promise<Ack> {
    return this.run(async () => {
      if (typeof body?.color !== 'string') throw new TeamMakerError('INVALID');
      await this.service.vote(client.id, body.color);
      return {};
    });
  }

  @SubscribeMessage('tm:nick')
  nick(@ConnectedSocket() client: Socket, @MessageBody() body: { nick?: unknown }): Promise<Ack> {
    return this.run(() => ({ nick: this.service.setNick(client.id, body?.nick) }));
  }

  @SubscribeMessage('tm:react')
  react(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { emoteId?: unknown; text?: unknown },
  ): Promise<Ack> {
    return this.run(async () => {
      await this.service.react(client.id, { emoteId: body?.emoteId, text: body?.text });
      return {};
    });
  }

  /** Corre la accion y la convierte en ack: nada que lance llega a socket.io. */
  private async run(fn: () => Promise<Record<string, unknown>> | Record<string, unknown>): Promise<Ack> {
    try {
      return { ok: true, ...(await fn()) };
    } catch (error) {
      if (error instanceof TeamMakerError) return { ok: false, error: error.code };
      if (error instanceof HttpException) {
        const response = error.getResponse() as { errorCode?: string };
        return { ok: false, error: response?.errorCode ?? 'ERROR' };
      }
      this.logger.error(error);
      return { ok: false, error: 'INTERNAL' };
    }
  }
}
