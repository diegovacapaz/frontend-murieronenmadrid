import { Logger } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Request, Response } from 'express';
import type { GlobalsService } from '../globals/globals.service';
import { cerrarEnSilencio } from './cierre';
import {
  claveValida,
  decidirAcceso,
  extraerClave,
  LimitadorDeFallos,
  redactarUrl,
} from './mcp-auth';
import { NewsletterMcpService } from '../modules/newsletter/newsletter-mcp.service';
import { PoweradeMcpService } from '../modules/powerade/powerade-mcp.service';
import { INSTRUCCIONES_DEL_SERVIDOR, registrarHerramientasDelDiario } from './diario.tools';
import { registrarHerramientasDelPowerade } from './powerade.tools';

/**
 * Monta el servidor MCP en `/mcp`.
 *
 * ## Por qué un middleware de Express y no un controller de Nest
 *
 * El backend tiene un `ApiResponseInterceptor` global que envuelve TODA
 * respuesta en `ApiResponseDto`, un `ValidationPipe` con `forbidNonWhitelisted`,
 * un filter global y el `AdminGuard`. Cualquiera de los cuatro rompe el
 * protocolo MCP, que habla JSON-RPC y no tiene sobre propio. Un middleware que
 * atiende el pedido y NO llama a `next()` no pasa por ninguno.
 *
 * Por lo mismo corre antes del body parser de Nest: se llama a
 * `transport.handleRequest(req, res)` sin `parsedBody` y el SDK lee el stream
 * él mismo (verificado con una prueba aparte antes de escribir esto).
 *
 * ## Sin estado
 *
 * Un `McpServer` y un transporte por pedido, que se cierran cuando la respuesta
 * se cierra. Nada vive entre dos requests.
 *
 * ## La clave no se loguea
 *
 * Puede venir en la ruta (`/mcp/<clave>`), así que NADA en este archivo loguea
 * `req.url` ni `req.originalUrl`. Los errores se loguean por su mensaje.
 */
export function montarMcp(app: INestApplication, globals: GlobalsService): void {
  const logger = new Logger('Mcp');
  const clave = globals.get('MCP_API_KEY');

  if (!clave) {
    logger.log('MCP apagado: falta MCP_API_KEY, /mcp no existe');
    return;
  }

  const limitador = new LimitadorDeFallos();
  // El módulo de newsletter ya está resuelto cuando se llega acá: NestFactory.create
  // instancia los providers antes de devolver la app.
  const diario = app.get(NewsletterMcpService);
  const powerade = app.get(PoweradeMcpService);

  // Diagnóstico: una línea por pedido que NO sea de la API del sitio, con el
  // método, la URL con la clave tapada, el status y si llegó algún header de
  // clave (sólo si está o no, nunca su valor). Sirve para ver qué pide un cliente
  // MCP que no logra conectar, incluidas las rutas de descubrimiento de OAuth que
  // caen en el 404 de Nest. Va ANTES que el handler de /mcp para verlo todo.
  app.use((req: Request, res: Response, next: () => void) => {
    const url = req.originalUrl;
    if (!url.startsWith('/api')) {
      res.on('finish', () => {
        const headers = [
          req.headers.authorization ? 'authorization' : null,
          req.headers['x-api-key'] ? 'x-api-key' : null,
        ].filter(Boolean);
        logger.log(
          `${req.method} ${redactarUrl(url)} → ${res.statusCode} [claves por header: ${
            headers.length > 0 ? headers.join(', ') : 'ninguna'
          }]`,
        );
      });
    }
    next();
  });

  app.use('/mcp', async (req: Request, res: Response) => {
    const ip = req.ip ?? 'desconocida';

    // El orden es deliberado. La clave se chequea ANTES que el método: un GET sin
    // clave tiene que dar 401 y no 405, porque un 405 le confirmaría a cualquiera
    // que /mcp existe. Y una clave válida pasa aunque la IP esté bloqueada: ver
    // `decidirAcceso`.
    const acceso = decidirAcceso(
      claveValida(extraerClave(req.headers, req.url), clave),
      limitador.bloqueado(ip, Date.now()),
    );

    if (acceso === 'frenar') {
      res.status(429).json({ error: 'too_many_attempts' });
      return;
    }

    if (acceso === 'rechazar') {
      limitador.registrarFallo(ip, Date.now());
      // Pelado: no dice si faltaba o si estaba mal.
      res.status(401).json({ error: 'unauthorized' });
      return;
    }

    // Modo sin estado: no hay stream GET ni sesiones que cerrar.
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'method_not_allowed' });
      return;
    }

    try {
      const server = new McpServer(
        { name: 'murieron-news', version: '0.1.0' },
        { instructions: INSTRUCCIONES_DEL_SERVIDOR },
      );
      registrarHerramientasDelDiario(server, diario, (mensaje) => logger.log(mensaje));
      registrarHerramientasDelPowerade(server, powerade, (mensaje) => logger.log(mensaje));

      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on('close', () => cerrarEnSilencio(transport, server));

      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (error) {
      logger.error(
        `Falló un pedido MCP: ${error instanceof Error ? error.message : 'error desconocido'}`,
      );
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
    }
  });

  logger.log('MCP encendido en /mcp');
}
