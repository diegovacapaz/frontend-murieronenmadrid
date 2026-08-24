import type Anthropic from '@anthropic-ai/sdk';

/** Tope de notas por edición. Diez ya es un diario gordo. */
export const MAX_NOTAS = 10;

/**
 * La única forma en que el modelo publica.
 *
 * `strict: true` hace que la API garantice la FORMA del input: que venga
 * `notas`, que cada nota tenga las cinco claves obligatorias, que `seccion` y
 * `rol` sean uno de los literales del enum, que no haya claves de más. Eso es
 * lo que evita tener que parsear prosa buscando un JSON.
 *
 * **Lo que NO garantiza son los largos ni los topes de array.** El subconjunto
 * de JSON Schema que la API acepta para structured outputs excluye las
 * restricciones de string y las de array complejas: el normalizador del propio
 * SDK (`transform-json-schema.ts`) conserva `type`, `properties`, `required`,
 * `additionalProperties`, `items` y `minItems` sólo cuando vale 0 o 1, y
 * degrada el resto a texto de descripción. Y ese normalizador corre en el
 * camino de los helpers: un `Anthropic.Tool` crudo como este viaja tal cual.
 *
 * O sea que `maxLength`, `maxItems` y `minItems: 1` acá valen como pista para
 * el modelo, no como contrato. El que hace cumplir los topes de las columnas es
 * `edition.validator.ts`, que recorta. Ahí también viven las reglas que ningún
 * schema puede expresar: que haya exactamente una portada, que los playerId
 * existan y que no se repitan dentro de una nota.
 *
 * Se dejan declarados igual porque son documentación que el modelo lee y porque
 * el día que la API los soporte empiezan a valer sin tocar nada. Riesgo abierto
 * para el dry-run: si la API los RECHAZA con 400 en vez de ignorarlos, el
 * diario no publica nunca — es lo primero que hay que mirar en la primera
 * llamada real.
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
        maxItems: MAX_NOTAS,
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
              maxItems: 8,
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
