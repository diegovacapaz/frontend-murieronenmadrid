import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { PoweradeMcpService } from '../modules/powerade/powerade-mcp.service';
import { aResultadoDeHerramienta } from './diario.tools';

/**
 * Registra las tres herramientas del Powerade, en el mismo servidor MCP que las del
 * diario.
 *
 * Los `inputSchema` se mantienen CHICOS a propósito (hay un reporte de que claude.ai
 * descarta en silencio una herramienta cuyo schema serializado pasa de 16.384 bytes)
 * y **`top3` no lleva `.length(3)`**: un `length` rechazaría en el protocolo, con un
 * error genérico, algo que `validarTop3` puede explicar mucho mejor ("hacen falta
 * tres jugadores y mandaste dos", junto con los otros problemas).
 *
 * Las descripciones son lo primero que lee el redactor: dicen CUÁNDO llamar a cada
 * una y qué devuelve.
 */
export function registrarHerramientasDelPowerade(
  server: McpServer,
  servicio: Pick<PoweradeMcpService, 'iniciar' | 'material' | 'publicar'>,
  log: (mensaje: string) => void,
): void {
  server.registerTool(
    'powerade_iniciar',
    {
      description:
        'Es lo PRIMERO que se hace para armar el ranking Powerade de un torneo en juego: ' +
        'los tres mejores jugadores según la IA. Arma el borrador y devuelve el manual que ' +
        'hay que seguir, el draftId, el torneo, los jugadores que lo jugaron, cuántos ' +
        'partidos son nuevos y, si ya hubo un ranking antes, cómo quedó. Sin tournamentId ' +
        'usa el torneo en juego.',
      inputSchema: {
        tournamentId: z
          .number()
          .int()
          .optional()
          .describe('El torneo a rankear. Si no se manda, el que está en juego.'),
      },
    },
    ({ tournamentId }) => aResultadoDeHerramienta(() => servicio.iniciar(tournamentId), log),
  );

  server.registerTool(
    'powerade_material',
    {
      description:
        'Devuelve una pieza del material de un borrador como JSON: torneo (la tabla y las ' +
        'estadísticas del torneo), jugadores (el resumen, las rachas, los destacados y los ' +
        'logros de quienes lo jugaron) o historial (todos los partidos, o sólo los ' +
        'posteriores a desdeMatchId). Las respuestas son grandes y quedan guardadas como ' +
        'archivo: se trabajan con código, sin retipear. Se llama después de ' +
        'powerade_iniciar, con su draftId.',
      inputSchema: {
        draftId: z.string().describe('El draftId que devolvió powerade_iniciar.'),
        parte: z.enum(['torneo', 'jugadores', 'historial']),
        desdeMatchId: z
          .number()
          .int()
          .optional()
          .describe('Sólo para historial: trae los partidos con matchId mayor a este.'),
      },
    },
    ({ draftId, parte, desdeMatchId }) =>
      aResultadoDeHerramienta(async () => servicio.material(draftId, parte, desdeMatchId), log),
  );

  server.registerTool(
    'powerade_publicar',
    {
      description:
        'Publica el ranking. Es lo ÚLTIMO que se hace, una sola vez, con exactamente tres ' +
        'jugadores EN ORDEN de puesto (el primero es el mejor), cada uno con su playerId y ' +
        'una razon de hasta 300 caracteres. Si devuelve un error, trae los problemas: se ' +
        'corrigen y se vuelve a llamar con el mismo draftId.',
      inputSchema: {
        draftId: z.string().describe('El draftId que devolvió powerade_iniciar.'),
        top3: z.array(
          z.object({
            playerId: z.number().int(),
            razon: z.string().describe('Una sola oración: por qué ese puesto, con un dato verificado.'),
          }),
        ),
      },
    },
    ({ draftId, top3 }) => aResultadoDeHerramienta(() => servicio.publicar(draftId, top3), log),
  );
}
