import { ArticleSection, PlayerRole } from '../enums/newsletter.enums';
import type { NotaValidada, ResultadoValidacion } from '../interfaces/validacion';

/** Los nombres que ve el modelo → el CHAR(1) que guarda la base. */
const SECCIONES: Record<string, ArticleSection> = {
  PORTADA: ArticleSection.PORTADA,
  TORNEO: ArticleSection.TORNEO,
  HISTORICA: ArticleSection.HISTORICA,
  MUNDIALITO: ArticleSection.MUNDIALITO,
  VITRINA: ArticleSection.VITRINA,
  CLASICOS: ArticleSection.CLASICOS,
  ANTICIPOS: ArticleSection.ANTICIPOS,
  BREVES: ArticleSection.BREVES,
};

const ROLES: Record<string, PlayerRole> = {
  HEROE: PlayerRole.HEROE,
  VILLANO: PlayerRole.VILLANO,
  MENCION: PlayerRole.MENCION,
};

/** Topes de las columnas de NewsletterArticles. */
const LIMITES = { titular: 120, copete: 240, cuerpo: 16000 } as const;

function recortar(valor: unknown, tope: number): string {
  return typeof valor === 'string' ? valor.trim().slice(0, tope) : '';
}

/**
 * Lo que el schema de la herramienta no puede expresar.
 *
 * `strict: true` ya garantizó que el input tenga la forma declarada, así que
 * esto NO vuelve a validar tipos. Chequea tres reglas de negocio y hace una
 * traducción:
 *
 *   · exactamente una portada — cero o dos y la edición no se publica;
 *   · las menciones a jugadores que no existen se DESCARTAN, no tiran la nota:
 *     que el modelo se haya equivocado con un id no es razón para perder una
 *     crónica que puede estar perfecta;
 *   · la portada queda primera, sin importar en qué orden vino;
 *   · y recorta los textos. El schema declara maxLength, pero recortar es más
 *     barato que una excepción de MySQL a las cinco de la mañana.
 */
export function validarEdicion(
  input: unknown,
  playerIdsValidos: Set<number>,
): ResultadoValidacion {
  if (typeof input !== 'object' || input === null) {
    return { ok: false, motivo: 'El input no es un objeto' };
  }

  const crudas = (input as { notas?: unknown }).notas;
  if (!Array.isArray(crudas) || crudas.length === 0) {
    return { ok: false, motivo: 'No vino ninguna nota' };
  }

  const notas: NotaValidada[] = [];

  for (const cruda of crudas) {
    if (typeof cruda !== 'object' || cruda === null) continue;
    const nota = cruda as Record<string, unknown>;

    const seccion = SECCIONES[String(nota.seccion)];
    if (!seccion) continue;

    const titular = recortar(nota.titular, LIMITES.titular);
    const cuerpo = recortar(nota.cuerpo, LIMITES.cuerpo);
    if (titular === '' || cuerpo === '') continue;

    const jugadores = (Array.isArray(nota.jugadores) ? nota.jugadores : [])
      .map((j) => j as Record<string, unknown>)
      .filter(
        (j) => playerIdsValidos.has(Number(j.playerId)) && ROLES[String(j.rol)],
      )
      .map((j) => ({ playerId: Number(j.playerId), rol: ROLES[String(j.rol)] }));

    notas.push({
      seccion,
      titular,
      copete: recortar(nota.copete, LIMITES.copete),
      cuerpo,
      jugadores,
    });
  }

  const portadas = notas.filter((n) => n.seccion === ArticleSection.PORTADA);
  if (portadas.length !== 1) {
    return {
      ok: false,
      motivo: `Se esperaba exactamente una nota de portada y vinieron ${portadas.length}`,
    };
  }

  // La portada primero. El resto conserva el orden en que vino: el modelo
  // decidió esa jerarquía y no hay motivo para pisarla.
  const resto = notas.filter((n) => n.seccion !== ArticleSection.PORTADA);
  return { ok: true, notas: [...portadas, ...resto] };
}
