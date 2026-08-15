/**
 * Convierte un TS string enum a un tuple no-vacio de sus valores.
 *
 * Pensado para alimentar listas de valores validos (Swagger, IsIn) cuando el
 * enum es la unica fuente de verdad: si gana o pierde una variante, la lista se
 * actualiza sola.
 *
 * Restringido a string enums — los numericos tienen reverse mapping y romperian
 * Object.values.
 */
export function enumValues<E extends Record<string, string>>(
  e: E,
): readonly [E[keyof E], ...E[keyof E][]] {
  const values = Object.values(e) as E[keyof E][];
  if (values.length === 0) {
    throw new Error('enumValues: source enum has no values');
  }
  return values as unknown as readonly [E[keyof E], ...E[keyof E][]];
}
