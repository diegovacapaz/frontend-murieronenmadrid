import { ArticleSection, PlayerRole } from '../enums/newsletter.enums';
import type { NotaValidada, ResultadoValidacion } from '../interfaces/validacion';
import { MAX_JUGADORES_POR_NOTA, MAX_NOTAS } from '../newsletter.tool';

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

/** Más largo que esto y de una sola línea, un cuerpo de BREVES ya es un párrafo y no un breve. */
const UMBRAL_BREVE_EN_UN_PARRAFO = 280;

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
  titular: string,
  descartes: string[],
): NotaValidada['jugadores'] {
  const porJugador = new Map<number, PlayerRole>();

  for (const crudo of Array.isArray(crudos) ? crudos : []) {
    if (typeof crudo !== 'object' || crudo === null) {
      descartes.push(`La nota "${titular}" trae una mención que no tiene la forma esperada`);
      continue;
    }
    const jugador = crudo as Record<string, unknown>;

    const playerId = Number(jugador.playerId);
    const rol = ROLES[String(jugador.rol)];
    if (!rol) {
      descartes.push(
        `La nota "${titular}" trae un rol que no existe ("${String(jugador.rol)}") ` +
          `para el jugador ${String(jugador.playerId)}`,
      );
      continue;
    }
    if (!playerIdsValidos.has(playerId)) {
      descartes.push(
        `La nota "${titular}" menciona un playerId que no existe (${String(jugador.playerId)})`,
      );
      continue;
    }

    const previo = porJugador.get(playerId);
    if (previo === undefined || PESO_ROL[rol] > PESO_ROL[previo]) {
      porJugador.set(playerId, rol);
    }
  }

  // El tope también se recorta acá: `maxItems` hace que la API rechace la
  // herramienta entera (ver newsletter.tool.ts), así que en el schema no está y
  // el único que lo puede hacer cumplir es este.
  if (porJugador.size > MAX_JUGADORES_POR_NOTA) {
    descartes.push(
      `La nota "${titular}" tiene ${porJugador.size} jugadores distintos y el máximo es ` +
        `${MAX_JUGADORES_POR_NOTA}: se perderían los últimos`,
    );
  }

  return [...porJugador]
    .slice(0, MAX_JUGADORES_POR_NOTA)
    .map(([playerId, rol]) => ({ playerId, rol }));
}

/**
 * Lo que el schema de la herramienta no puede expresar.
 *
 * `strict: true` garantiza la FORMA y los TIPOS: que venga `notas`, que cada
 * nota tenga las cinco claves, que `seccion` sea uno de los ocho literales.
 * **No garantiza ni los largos ni las cantidades.** Los largos porque el
 * subconjunto de structured outputs deja afuera las restricciones de string, y
 * las cantidades porque `maxItems` directamente hace que la API rechace la
 * herramienta con un 400 y por eso no está en el schema (ver
 * `newsletter.tool.ts`).
 *
 * O sea que este archivo es el ÚNICO lugar donde los topes existen de verdad.
 * Nada de lo que hace es de más:
 *
 *   · recorta los textos a los topes REALES de las columnas — la defensa contra
 *     un `data too long` a las cinco de la mañana;
 *   · recorta a diez notas y a ocho jugadores por nota;
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
  const descartes: string[] = [];

  for (const cruda of crudas) {
    if (typeof cruda !== 'object' || cruda === null) {
      descartes.push('Una de las notas no tiene la forma esperada y se tiró');
      continue;
    }
    const nota = cruda as Record<string, unknown>;

    const seccion = SECCIONES[String(nota.seccion)];
    if (!seccion) {
      descartes.push(`Una nota tiene una sección que no existe ("${String(nota.seccion)}")`);
      continue;
    }

    const titular = recortar(nota.titular, LIMITES.titular);
    const cuerpo = recortar(nota.cuerpo, LIMITES.cuerpo);
    if (titular === '' || cuerpo === '') {
      descartes.push(
        `La nota "${titular || '(sin titular)'}" se descartó por no tener titular o cuerpo`,
      );
      continue;
    }

    // El frontend dibuja los BREVES como lista, un punto por línea del cuerpo. Un
    // párrafo largo de una sola línea sale como UN punto con todo adentro: no se
    // pierde nada, pero no es lo que el diario promete. El manual lo pide, pero un
    // manual se puede ignorar; esto lo informa para que el MCP lo haga corregir.
    // Un breve corto de una sola línea es legítimo, por eso el umbral de largo.
    if (seccion === ArticleSection.BREVES) {
      const items = cuerpo.split('\n').filter((linea) => linea.trim() !== '');
      if (items.length < 2 && cuerpo.length > UMBRAL_BREVE_EN_UN_PARRAFO) {
        descartes.push(
          `La nota de BREVES "${titular.slice(0, 40)}" es un solo párrafo de ${cuerpo.length} ` +
            'caracteres: tiene que ser una lista de tres a cinco ítems cortos, uno por línea ' +
            'y separados por una línea en blanco',
        );
      }
    }

    // Los textos que pasan de la columna se recortan sin decir nada; acá se anota
    // para que quien lo quiera saber (el MCP) pueda pedir que se acorten.
    for (const [campo, tope] of Object.entries(LIMITES)) {
      const largo = typeof nota[campo] === 'string' ? (nota[campo] as string).trim().length : 0;
      if (largo > tope) {
        descartes.push(
          `El ${campo} de la nota "${titular.slice(0, 40)}" pasa de ${tope} caracteres ` +
            `(tiene ${largo}) y se recortaría`,
        );
      }
    }

    notas.push({
      seccion,
      titular,
      copete: recortar(nota.copete, LIMITES.copete),
      cuerpo,
      jugadores: jugadoresDeLaNota(nota.jugadores, playerIdsValidos, titular, descartes),
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
  //
  // Y el recorte a MAX_NOTAS va DESPUÉS de poner la portada adelante, no antes:
  // si el modelo mandó veinticinco notas con la portada en el puesto quince,
  // recortar primero la tiraría y la edición se rechazaría por no tener
  // portada. Al revés, la portada sobrevive siempre y lo que se pierde es la
  // cola, que es lo que el propio modelo dejó para el final.
  const resto = notas.filter((n) => n.seccion !== ArticleSection.PORTADA);
  const ordenadas = [...portadas, ...resto];
  if (ordenadas.length > MAX_NOTAS) {
    descartes.push(
      `Mandaste ${ordenadas.length} notas y el máximo es ${MAX_NOTAS}: se perderían las últimas ` +
        `${ordenadas.length - MAX_NOTAS}`,
    );
  }

  return { ok: true, notas: ordenadas.slice(0, MAX_NOTAS), descartes };
}
