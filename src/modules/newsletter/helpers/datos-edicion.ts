import type { Dossier } from '../interfaces/dossier';
import type { DatosEdicion } from '../interfaces/newsletter.repository.interface';
import type { NotaValidada } from '../interfaces/validacion';

/**
 * Lo que va a la fila de la edición, para cualquiera de los dos caminos que
 * publican: la API y el MCP.
 *
 * `lastMatchId`, `snapshotVersion` y `snapshot` salen del DOSSIER y no de una
 * lectura nueva. Es la regla que sostiene el diff de mañana: el puntero y la
 * foto que se guardan tienen que ser los del material que el redactor
 * efectivamente vio, no los de un instante posterior. Si entre el armado y la
 * publicación entró un partido, anotar el número de ahora lo daría por contado
 * sin que nadie lo haya contado.
 *
 * Los tokens vienen de afuera porque cada camino los mide distinto: la API los
 * suma del `usage` de la respuesta, y el MCP no tiene cómo medirlos y manda cero.
 */
export function armarDatosEdicion(
  publishedOn: string,
  dossier: Dossier,
  notas: NotaValidada[],
  uso: { model: string; inputTokens: number; outputTokens: number },
): DatosEdicion {
  return {
    publishedOn,
    lastMatchId: dossier.contexto.ultimoMatchId,
    snapshotVersion: dossier.estado.version,
    snapshot: dossier.estado,
    model: uso.model,
    inputTokens: uso.inputTokens,
    outputTokens: uso.outputTokens,
    notas,
  };
}
