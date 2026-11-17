import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ErrorParaElRedactor } from './errores';
import type { NewsletterMcpService } from '../modules/newsletter/newsletter-mcp.service';

/**
 * Lo que devuelve una herramienta MCP: texto, y `isError` cuando falló.
 *
 * Es un `type` y no una `interface` a propósito: el SDK pide un resultado con
 * firma de índice (`[x: string]: unknown`) y una interface no la cumple, aunque
 * los campos coincidan.
 */
export type ResultadoDeHerramienta = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: true;
};

const ERROR_INTERNO =
  'Error interno del diario. Probá de nuevo; si sigue, avisale al editor.';

/**
 * Convierte lo que hace una herramienta en lo que MCP espera devolver.
 *
 * Un `ErrorParaElRedactor` (de cualquier producto) ya trae un mensaje pensado para el redactor y sale tal
 * cual. **Cualquier otra cosa es un error inesperado y NO se le entrega al
 * cliente**: un mensaje de MySQL o una ruta del servidor no es algo para
 * devolverle a un modelo (ni a quien lo esté mirando por encima del hombro). Se
 * loguea el real y se devuelve un texto fijo.
 *
 * La serialización está adentro del `try` a propósito: un resultado que no se
 * puede serializar tiene que ser un error interno y no una excepción que escape.
 */
export async function aResultadoDeHerramienta(
  trabajo: () => Promise<unknown>,
  log: (mensaje: string) => void = () => undefined,
): Promise<ResultadoDeHerramienta> {
  try {
    const resultado = await trabajo();
    const texto =
      typeof resultado === 'string' ? resultado : (JSON.stringify(resultado) ?? '');
    return { content: [{ type: 'text', text: texto }] };
  } catch (error) {
    if (error instanceof ErrorParaElRedactor) {
      return { isError: true, content: [{ type: 'text', text: error.message }] };
    }

    log(`Error inesperado en una herramienta del diario: ${error instanceof Error ? error.message : String(error)}`);
    return { isError: true, content: [{ type: 'text', text: ERROR_INTERNO }] };
  }
}

/**
 * Lo primero que ve el cliente, antes de llamar a nada.
 *
 * El manual completo le llega después, como resultado de `diario_iniciar`, y un
 * resultado de herramienta pesa menos que un system prompt: con la API el manual
 * era el system. Por eso acá se repite, en pocas líneas, lo que no se negocia:
 * es lo que más se pierde si el cliente le da menos peso al manual.
 *
 * Y los BREVES, porque el contrato con el frontend (un ítem por línea) no estaba
 * escrito en ningún lado y la primera edición por MCP salió con un solo párrafo.
 */
export const INSTRUCCIONES_DEL_SERVIDOR =
  'Para escribir una edición de MurieronNews, llamá primero a diario_iniciar y ' +
  'seguí el manual que devuelve. Para el ranking Powerade de un torneo en juego, ' +
  'llamá a powerade_iniciar. Lo que no se negocia: todo número que afirmes se ' +
  'cuenta con código sobre el material, nunca se estima leyendo; las burlas son de ' +
  'cómo juega alguien y no de quién es: nada sobre el cuerpo, la familia, la salud, ' +
  'la plata ni el trabajo de nadie, salvo que las notas del jugador lo habiliten ' +
  'como chiste del grupo; va una sola nota de PORTADA; ortografía completa, con ' +
  'tildes y signos de apertura; los BREVES son de tres a cinco ítems cortos ' +
  'separados por una línea en blanco, nunca un solo párrafo.';

/** Los mismos ocho literales que `PUBLICAR_EDICION_TOOL`, que es el contrato con el validador. */
const SECCIONES = [
  'PORTADA',
  'TORNEO',
  'HISTORICA',
  'MUNDIALITO',
  'VITRINA',
  'CLASICOS',
  'ANTICIPOS',
  'BREVES',
] as const;

/**
 * Registra las tres herramientas del diario.
 *
 * Los `inputSchema` se mantienen CHICOS a propósito: hay un reporte de que
 * claude.ai descarta en silencio una herramienta cuyo schema serializado pasa de
 * 16.384 bytes. Los topes de largo y cantidad no van acá sino en
 * `validarEdicion`, que es donde existen de verdad.
 *
 * Las descripciones son lo primero que lee el redactor: dicen CUÁNDO llamar a
 * cada una y qué devuelve.
 */
export function registrarHerramientasDelDiario(
  server: McpServer,
  servicio: Pick<NewsletterMcpService, 'iniciar' | 'material' | 'publicar'>,
  log: (mensaje: string) => void,
): void {
  server.registerTool(
    'diario_iniciar',
    {
      description:
        'Es lo PRIMERO que se hace para escribir una edición de MurieronNews. Arma el ' +
        'borrador y devuelve el manual que hay que seguir, el draftId, cuántos partidos ' +
        'son nuevos, los jugadores con su playerId, el lore y los titulares recientes. ' +
        'Con regenerarFecha (YYYY-MM-DD) reescribe la edición de esa fecha en vez de ' +
        'crear la de hoy.',
      inputSchema: {
        regenerarFecha: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe('Fecha YYYY-MM-DD de una edición ya publicada que se quiere reescribir.'),
      },
    },
    ({ regenerarFecha }) => aResultadoDeHerramienta(() => servicio.iniciar(regenerarFecha), log),
  );

  server.registerTool(
    'diario_material',
    {
      description:
        'Devuelve una pieza del material de un borrador como JSON: historial (todos los ' +
        'partidos, o sólo los posteriores a desdeMatchId), estado (la foto de hoy) o ' +
        'estado_anterior (la foto de la edición pasada). Las respuestas son grandes y ' +
        'quedan guardadas como archivo: se trabajan con código, sin retipear. Se llama ' +
        'después de diario_iniciar, con su draftId.',
      inputSchema: {
        draftId: z.string().describe('El draftId que devolvió diario_iniciar.'),
        parte: z.enum(['historial', 'estado', 'estado_anterior']),
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
    'diario_publicar',
    {
      description:
        'Publica la edición. Es lo ÚLTIMO que se hace, una sola vez, con todas las notas ' +
        'juntas y exactamente una de sección PORTADA. Si devuelve un error, trae el ' +
        'motivo: se corrige y se vuelve a llamar con el mismo draftId.',
      inputSchema: {
        draftId: z.string().describe('El draftId que devolvió diario_iniciar.'),
        notas: z.array(
          z.object({
            seccion: z.enum(SECCIONES),
            titular: z.string(),
            copete: z.string(),
            cuerpo: z.string(),
            jugadores: z.array(
              z.object({
                playerId: z.number().int(),
                rol: z.enum(['HEROE', 'VILLANO', 'MENCION']),
              }),
            ),
          }),
        ),
      },
    },
    ({ draftId, notas }) => aResultadoDeHerramienta(() => servicio.publicar(draftId, notas), log),
  );
}
