import type { LastEdition } from '../entities/edition.entity';
import type { Dossier } from '../interfaces/dossier';

/** Las tres piezas del material que el redactor puede pedir con `diario_material`. */
export type ParteDelMaterial = 'historial' | 'estado' | 'estado_anterior';

/**
 * Cuántos partidos se cargaron desde la edición anterior.
 *
 * Sale del puntero y no de "el último día con partidos": con un diario que sale
 * cuando alguien se lo pide, pasan varios días entre ediciones, y contar sólo la
 * última jornada se quedaría corto. Sin puntero (no hay edición anterior) todos
 * los partidos son nuevos.
 */
export function contarPartidosNuevos(
  historial: Array<{ matchId: number }>,
  punteroAnterior: number | null,
): number {
  if (punteroAnterior === null) return historial.length;
  return historial.filter((partido) => partido.matchId > punteroAnterior).length;
}

/**
 * Una pieza del material de un borrador, como texto JSON listo para devolver.
 *
 * **Compacto, sin indentar**: lo que devuelve una herramienta MCP viaja como
 * caracteres, y la indentación de un estado de 140.000 caracteres es puro peso
 * que además cuenta contra la cuota de quien la lee.
 *
 * Devuelve `null` sólo cuando se pide `estado_anterior` y no hay con qué: la
 * edición anterior no existe o se guardó sin foto. Es la inaugural, y ahí no hay
 * nada que diffear.
 *
 * `desdeMatchId` sólo aplica al historial: limita a los partidos posteriores a
 * ese id, que es la forma de ver únicamente lo ocurrido desde el puntero.
 */
export function extraerMaterial(
  base: { dossier: Dossier; anterior: LastEdition | null },
  parte: ParteDelMaterial,
  desdeMatchId?: number,
): string | null {
  switch (parte) {
    case 'historial': {
      const partidos =
        desdeMatchId === undefined
          ? base.dossier.historial
          : base.dossier.historial.filter((partido) => partido.matchId > desdeMatchId);
      return JSON.stringify(partidos);
    }
    case 'estado':
      return JSON.stringify(base.dossier.estado);
    case 'estado_anterior':
      return base.anterior?.snapshot ? JSON.stringify(base.anterior.snapshot) : null;
  }
}
