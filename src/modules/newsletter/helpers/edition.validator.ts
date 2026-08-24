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

/**
 * Peso de cada rol, para cuando el modelo nombra al mismo jugador dos veces en
 * la misma nota. Gana el más fuerte: si alguien es héroe y mención, es héroe.
 */
const PESO_ROL: Record<PlayerRole, number> = {
  [PlayerRole.HEROE]: 3,
  [PlayerRole.VILLANO]: 2,
  [PlayerRole.MENCION]: 1,
};

/** Topes de las columnas de NewsletterArticles. */
const LIMITES = { titular: 120, copete: 240, cuerpo: 16000 } as const;

function recortar(valor: unknown, tope: number): string {
  return typeof valor === 'string' ? valor.trim().slice(0, tope) : '';
}

/**
 * Los jugadores de una nota, filtrados y SIN REPETIDOS.
 *
 * La deduplicación no es prolijidad: `NewsletterArticlePlayers` tiene
 * `PRIMARY KEY (articleId, playerId)`, así que el mismo playerId dos veces en
 * una nota —cosa que el schema de la herramienta no puede prohibir, y que pasa
 * naturalmente cuando el modelo lo nombra como héroe de un párrafo y mención de
 * otro— es un `ER_DUP_ENTRY` que se lleva puesta la edición ENTERA, no la nota.
 * Es exactamente la clase de regla que el validador existe para atajar.
 *
 * Se conserva el orden en que vinieron (el Map lo garantiza) y, del repetido,
 * el rol de más peso: el rol decide qué foto ilustra la nota y quedarse con la
 * mención de alguien que era el héroe cambia la portada.
 */
function jugadoresDeLaNota(
  crudos: unknown,
  playerIdsValidos: Set<number>,
): NotaValidada['jugadores'] {
  const porJugador = new Map<number, PlayerRole>();

  for (const crudo of Array.isArray(crudos) ? crudos : []) {
    if (typeof crudo !== 'object' || crudo === null) continue;
    const jugador = crudo as Record<string, unknown>;

    const playerId = Number(jugador.playerId);
    const rol = ROLES[String(jugador.rol)];
    if (!rol || !playerIdsValidos.has(playerId)) continue;

    const previo = porJugador.get(playerId);
    if (previo === undefined || PESO_ROL[rol] > PESO_ROL[previo]) {
      porJugador.set(playerId, rol);
    }
  }

  return [...porJugador].map(([playerId, rol]) => ({ playerId, rol }));
}

/**
 * Lo que el schema de la herramienta no puede expresar.
 *
 * `strict: true` garantiza la FORMA y los TIPOS: que venga `notas`, que cada
 * nota tenga las cinco claves, que `seccion` sea uno de los ocho literales.
 * **No garantiza los largos.** El subconjunto de JSON Schema que la API acepta
 * para structured outputs deja afuera las restricciones de string, así que
 * `maxLength` es —en el mejor de los casos— una sugerencia en prosa para el
 * modelo. Un titular de 300 caracteres puede llegar perfectamente.
 *
 * Por eso esto hace cuatro cosas, y el recorte NO es paranoia sino la única
 * defensa contra un `data too long` a las cinco de la mañana:
 *
 *   · recorta los textos a los topes REALES de las columnas;
 *   · exactamente una portada — cero o dos y la edición no se publica;
 *   · las menciones a jugadores que no existen se DESCARTAN, y los repetidos se
 *     unifican: que el modelo se haya equivocado con un id no es razón para
 *     perder una crónica que puede estar perfecta, y que haya nombrado dos
 *     veces al mismo tipo no es razón para perder la edición entera;
 *   · la portada queda primera, sin importar en qué orden vino.
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

    notas.push({
      seccion,
      titular,
      copete: recortar(nota.copete, LIMITES.copete),
      cuerpo,
      jugadores: jugadoresDeLaNota(nota.jugadores, playerIdsValidos),
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
