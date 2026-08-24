import type Anthropic from '@anthropic-ai/sdk';

/** Tope de notas por edición. Diez ya es un diario gordo. */
export const MAX_NOTAS = 10;

/**
 * La única forma en que el modelo publica.
 *
 * `strict: true` hace que la API garantice que el input valida contra este
 * schema, así que del lado nuestro no hay que parsear prosa buscando un JSON.
 * Lo que el schema NO puede expresar —que haya exactamente una portada, que los
 * playerId existan— lo chequea edition.validator.ts.
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
