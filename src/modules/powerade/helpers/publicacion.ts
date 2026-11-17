import type { BaseDelBorrador } from '../entities/powerade.entity';

/**
 * Qué hacer al publicar: insertar una versión nueva, reemplazar la vigente, o
 * rechazar porque alguien publicó en el medio.
 *
 * ## El conflicto se decide por IDENTIDAD, no por `lastMatchId`
 *
 * Un borrador se escribe sobre una BASE: la versión vigente que había al
 * empezar (o ninguna). Si al publicar la vigente no es **exactamente** esa base
 * —otro `rankingId` o otra `revision`—, otra conversación publicó mientras tanto
 * y este borrador está viejo: publicarlo pisaría un ranking más nuevo con uno
 * atrasado, o dos reemplazos sobre la misma base se pisarían sin aviso.
 *
 * Comparar por `lastMatchId` ("rechazar si es menor") sería peor: un partido
 * borrado puede dejar el máximo del torneo por debajo del de la versión vigente,
 * y esa regla bloquearía la publicación para siempre.
 *
 * Sin conflicto, lo único que decide entre insertar y reemplazar es si el
 * borrador contó partidos que la vigente no: con partidos nuevos es una versión
 * nueva (las flechas comparan contra la anterior); sin ellos —o con menos, si se
 * borró uno— se reescribe la misma.
 */
export function decidirPublicacion(
  base: BaseDelBorrador,
  lastMatchIdDelBorrador: number,
  vigente: BaseDelBorrador,
): 'insertar' | 'reemplazar' | 'conflicto' {
  if (base === null && vigente === null) return 'insertar';
  if (base === null || vigente === null) return 'conflicto';

  if (base.rankingId !== vigente.rankingId || base.revision !== vigente.revision) {
    return 'conflicto';
  }

  return lastMatchIdDelBorrador > vigente.lastMatchId ? 'insertar' : 'reemplazar';
}
