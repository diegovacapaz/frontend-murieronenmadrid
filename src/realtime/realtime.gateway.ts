import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

/**
 * Canal de tiempo real, en un solo sentido: el servidor emite, los clientes
 * escuchan. No hay handlers de mensajes entrantes a proposito — toda escritura
 * entra por HTTP, donde el AdminGuard puede exigir el token. Un socket que
 * acepte comandos seria una segunda puerta que habria que custodiar igual.
 *
 * Por eso tampoco hay autenticacion en la conexion: lo que viaja por aca es lo
 * mismo que cualquiera puede leer con un GET.
 */
@WebSocketGateway({
  cors: { origin: true, credentials: true },
  transports: ['websocket', 'polling'],
})
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  private server!: Server;

  // Nivel `debug`: los niveles activos se configuran en main.ts, asi que quien
  // decide si esto se ve es la configuracion del logger y no una bifurcacion
  // por entorno desperdigada en el codigo.
  handleConnection(client: Socket): void {
    this.logger.debug(`Socket conectado: ${client.id}`);
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(`Socket desconectado: ${client.id}`);
  }

  /**
   * Emite a todos los clientes conectados.
   *
   * El chequeo de `server` no es paranoia: si algo emite durante el arranque,
   * antes de que Nest inyecte el server, la propiedad todavia es undefined y
   * sin la guarda el proceso se cae por un evento de notificacion.
   */
  broadcast(event: string, payload: unknown): void {
    if (!this.server) {
      this.logger.warn(`Se intento emitir "${event}" sin server de sockets listo`);
      return;
    }
    this.server.emit(event, payload);
  }
}
