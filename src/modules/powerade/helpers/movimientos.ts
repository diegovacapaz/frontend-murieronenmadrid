import type { Movimiento } from '../entities/powerade.entity';

interface Puesto {
  position: number;
  playerId: number;
}

/**
 * Cómo se movió cada jugador del top 3 actual respecto del anterior.
 *
 * Devuelve un elemento por entrada de `actual` y en su mismo orden, para que
 * quien lo use pueda recorrerlas en paralelo. Sin versión anterior (`null`) no
 * hay con qué comparar y todo es `null`: la tarjeta no dibuja flechas.
 *
 * Quien no estaba entre los tres de antes `entra`: la comparación es contra el
 * top 3 anterior y no contra una tabla más larga, así que no se puede decir
 * cuántos lugares subió.
 */
export function calcularMovimientos(
  actual: Puesto[],
  anterior: Puesto[] | null,
): Array<Movimiento | null> {
  if (anterior === null) return actual.map(() => null);

  const antes = new Map(anterior.map((puesto) => [puesto.playerId, puesto.position]));

  return actual.map((puesto): Movimiento => {
    const posicionAnterior = antes.get(puesto.playerId);
    if (posicionAnterior === undefined) return { tipo: 'entra', lugares: 0 };

    const lugares = Math.abs(posicionAnterior - puesto.position);
    if (lugares === 0) return { tipo: 'igual', lugares: 0 };

    // Posición 1 es la mejor: pasar de un número más grande a uno más chico es subir.
    return { tipo: puesto.position < posicionAnterior ? 'sube' : 'baja', lugares };
  });
}
