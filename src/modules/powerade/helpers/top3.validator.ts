import { MAX_RAZON, PUESTOS } from '../powerade.constants';

export type ResultadoTop3 =
  | { ok: true; entradas: Array<{ playerId: number; reason: string }> }
  | { ok: false; problemas: string[] };

/**
 * Valida el top 3 que manda el redactor.
 *
 * **Junta todos los problemas** y no se detiene en el primero: el reintento es
 * gratis pero cada vuelta es una llamada, y decirle de una vez todo lo que está
 * mal evita un ida y vuelta por cada error.
 *
 * Y **no recorta nada en silencio**: una frase de más de `MAX_RAZON` se rechaza
 * con su largo. Recortarla dejaría publicar un texto cortado a la mitad que
 * nadie escribió así.
 *
 * `jugadoresDelTorneo` son los que jugaron al menos un partido: premiar a quien
 * no jugó nada no tiene sentido y un `playerId` inventado se traduciría en una
 * foto que no existe.
 */
export function validarTop3(input: unknown, jugadoresDelTorneo: Set<number>): ResultadoTop3 {
  if (!Array.isArray(input)) {
    return { ok: false, problemas: [`El top 3 tiene que ser una lista de tres jugadores`] };
  }

  const problemas: string[] = [];
  const entradas: Array<{ playerId: number; reason: string }> = [];

  if (input.length !== PUESTOS) {
    problemas.push(`Hacen falta exactamente tres jugadores y mandaste ${input.length}`);
  }

  const vistos = new Set<number>();

  input.forEach((crudo, indice) => {
    const puesto = indice + 1;

    if (typeof crudo !== 'object' || crudo === null) {
      problemas.push(`El puesto ${puesto} no tiene la forma { playerId, razon }`);
      return;
    }

    const { playerId, razon } = crudo as Record<string, unknown>;

    if (typeof playerId !== 'number' || !Number.isInteger(playerId)) {
      problemas.push(`El puesto ${puesto} no trae un playerId numérico`);
    } else if (vistos.has(playerId)) {
      problemas.push(`El jugador ${playerId} está repetido: cada uno va una sola vez`);
    } else {
      vistos.add(playerId);
      if (!jugadoresDelTorneo.has(playerId)) {
        problemas.push(`El playerId ${playerId} (puesto ${puesto}) no jugó este torneo`);
      }
    }

    const texto = typeof razon === 'string' ? razon.trim() : '';
    if (texto === '') {
      problemas.push(`El puesto ${puesto} no tiene frase: contá por qué ese jugador`);
    } else if (texto.length > MAX_RAZON) {
      problemas.push(
        `La frase del puesto ${puesto} tiene ${texto.length} caracteres y el máximo es ${MAX_RAZON}`,
      );
    }

    if (typeof playerId === 'number') entradas.push({ playerId, reason: texto });
  });

  return problemas.length > 0 ? { ok: false, problemas } : { ok: true, entradas };
}
