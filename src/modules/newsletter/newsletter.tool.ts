import type Anthropic from '@anthropic-ai/sdk';

/** Tope de notas por edición. Diez ya es un diario gordo. */
export const MAX_NOTAS = 16;

/** Tope de jugadores por nota. Más de ocho caras no entran en una ilustración. */
export const MAX_JUGADORES_POR_NOTA = 8;

/**
 * La única forma en que el modelo publica.
 *
 * ## Qué garantiza `strict: true` y qué no — verificado contra la API
 *
 * Garantiza la FORMA: que venga `notas`, que cada nota tenga las cinco claves
 * obligatorias, que `seccion` y `rol` sean uno de los literales del enum, que no
 * haya claves de más. Eso es lo que evita tener que parsear prosa buscando un
 * JSON.
 *
 * **`maxItems` NO ESTÁ SOPORTADO Y LA API RECHAZA LA REQUEST.** No es una
 * sospecha: se probó contra la API real y devuelve
 *
 *     400 invalid_request_error
 *     tools.0.custom: For 'array' type, property 'maxItems' is not supported
 *
 * O sea que con `maxItems` en el schema el diario **no publica nunca**: falla la
 * primera llamada del cron, y la del día siguiente, y todas. No con una edición
 * fea sino con una excepción a las cinco de la mañana. Por eso no está.
 *
 * Se probaron las cuatro variantes para acotar el arreglo al mínimo: el único
 * que rompe es `maxItems`. `maxLength` y `minItems` la API los acepta.
 *
 * **Pero aceptado no es lo mismo que aplicado.** El subconjunto de JSON Schema
 * de structured outputs excluye las restricciones de string, y el normalizador
 * del propio SDK (`transform-json-schema`) las degrada a texto de descripción —
 * y ese normalizador ni siquiera corre acá, porque un `Anthropic.Tool` crudo
 * como este viaja tal cual. `maxLength` vale como pista para el modelo, no como
 * contrato.
 *
 * ## Entonces, dónde viven los topes de verdad
 *
 * En `edition.validator.ts`, que recorta: los tres largos, las diez notas y los
 * ocho jugadores. Ahí también viven las reglas que ningún schema puede
 * expresar: que haya exactamente una portada, que los playerId existan y que no
 * se repitan dentro de una nota.
 *
 * ## Si alguna vez agregás una propiedad nueva al schema
 *
 * El error de la API reporta SOLO la primera propiedad no soportada que
 * encuentra, así que puede haber otra atrás. Después de tocar esto, hacé una
 * llamada real antes de darlo por bueno. Y si aparece una nueva rechazada, el
 * criterio es el mismo que se usó acá: sacarla del schema, ponerla en prosa en
 * el `description`, y hacerla cumplir en el validador.
 *
 * NO vuelvas a agregar `maxItems` "para que el schema quede completo". Está
 * probado que rompe.
 */
export const PUBLICAR_EDICION_TOOL: Anthropic.Tool = {
  name: 'publicarEdicion',
  description:
    'Publica la edición de hoy. Llamala una sola vez, cuando ya tengas todas ' +
    'las notas escritas y verificadas con código. Es la última cosa que hacés.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['notas'],
    properties: {
      notas: {
        type: 'array',
        minItems: 1,
        // El tope va en prosa porque `maxItems` hace que la API rechace la
        // herramienta entera. El validador lo hace cumplir recortando.
        description:
          'Las notas de la edición, como máximo diez. Diez ya es un diario ' +
          'gordo: cinco o seis bien elegidas es lo normal. Va exactamente una ' +
          'nota de sección PORTADA, ni cero ni dos. Si mandás más de diez, se ' +
          'publican las diez primeras y el resto se pierde.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['seccion', 'titular', 'copete', 'cuerpo', 'jugadores'],
          properties: {
            seccion: {
              type: 'string',
              enum: [
                'PORTADA',
                'TORNEO',
                'HISTORICA',
                'MUNDIALITO',
                'VITRINA',
                'CLASICOS',
                'ANTICIPOS',
                'BREVES',
              ],
            },
            titular: { type: 'string', maxLength: 90 },
            copete: { type: 'string', maxLength: 200 },
            cuerpo: { type: 'string', maxLength: 1600 },
            jugadores: {
              type: 'array',
              description:
                'Los jugadores de la nota, como máximo ocho, cada uno una ' +
                'sola vez y con un solo rol. Si mandás más de ocho se ' +
                'conservan los ocho primeros; si repetís a alguien se ' +
                'unifica en su rol más fuerte.',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['playerId', 'rol'],
                properties: {
                  playerId: { type: 'integer' },
                  rol: { type: 'string', enum: ['HEROE', 'VILLANO', 'MENCION'] },
                },
              },
            },
          },
        },
      },
    },
  },
};
