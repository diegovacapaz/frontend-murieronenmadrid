import 'reflect-metadata';
import './globals/timezone-bootstrap';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DossierBuilder } from './modules/newsletter/dossier.builder';
import { ArticleSection, PlayerRole } from './modules/newsletter/enums/newsletter.enums';
import type { Dossier } from './modules/newsletter/interfaces/dossier';
import type { INewsletterRepository } from './modules/newsletter/interfaces/newsletter.repository.interface';
import type { NotaValidada } from './modules/newsletter/interfaces/validacion';
import type { EjecucionDeCodigo, Generacion } from './modules/newsletter/newsletter.client';
import { NewsletterClient } from './modules/newsletter/newsletter.client';
import { NEWSLETTER_REPOSITORY } from './modules/newsletter/newsletter.constants';

/**
 * Genera una edición completa y la IMPRIME. No escribe una sola fila.
 *
 * Es con lo que se afina el prompt, que es donde está todo el riesgo real de
 * esta funcionalidad: el resto es CRUD y se prueba con tests. Iterar sobre el
 * tono publicando y borrando ediciones de prueba sería mucho peor.
 *
 * Vive en src/ y no en scripts/ como los verify-*.mjs, y es a propósito:
 * necesita el contenedor de inyección de Nest para conseguir los providers, y
 * eso pide TypeScript compilado con la misma configuración que el resto. Como
 * entrada de `nest build` lo consigue gratis.
 *
 * ## Qué imprime, y por qué no alcanza con las notas
 *
 * La salida es el producto de esta tarea, no un log. La lee una persona que
 * tiene que decidir dos cosas: si el diario le sirve, y si el prompt está
 * funcionando. Por eso además de las notas imprime:
 *
 *   · los jugadores de cada nota con su NOMBRE y su rol, no el playerId —
 *     nadie puede juzgar si "17 (VILLANO)" está bien elegido;
 *   · lo que el modelo corrió en el sandbox, que es la única señal directa de
 *     si la regla dura del prompt —"antes de afirmar un número, contalo con
 *     código"— se está cumpliendo. Un diario lindo con dos ejecuciones es un
 *     diario que estimó;
 *   · los cuatro contadores de tokens y el costo, porque `inputTokens` solo
 *     miente: excluye lo que se sirvió del caché, que es la mayor parte.
 *
 * Uso:
 *   npm run newsletter:dryrun
 */

/** Ancho de la caja de texto. 78 entra en cualquier terminal sin cortar. */
const ANCHO = 78;

/**
 * Los multiplicadores del caché, de la documentación de la API: escribir cuesta
 * 1,25x la entrada con el TTL de 5 minutos —el que usa el cliente— y leer
 * cuesta 0,1x. Esa asimetría es todo el negocio del prefijo cacheado.
 */
const CACHE_ESCRITURA = 1.25;
const CACHE_LECTURA = 0.1;

interface Tarifa {
  /** Dólares por millón de tokens de entrada. */
  entrada: number;
  /** Dólares por millón de tokens de salida. */
  salida: number;
  /** Promo de lanzamiento, mientras dure. */
  promo?: { entrada: number; salida: number; hasta: string };
}

/**
 * Las tarifas de la API.
 *
 * Están acá y no en la .env porque no son configuración: son un hecho externo
 * que alimenta UNA cuenta que solo hace este script. El día que cambien, el
 * costo impreso queda viejo y no se rompe nada — por eso un modelo que no esté
 * en la tabla no tira una excepción, solo dice que no sabe cuánto salió.
 */
const TARIFAS: Record<string, Tarifa> = {
  'claude-sonnet-5': {
    entrada: 3,
    salida: 15,
    promo: { entrada: 2, salida: 10, hasta: '2026-08-31' },
  },
  'claude-opus-5': { entrada: 5, salida: 25 },
  'claude-haiku-4-5': { entrada: 1, salida: 5 },
};

/** El CHAR(1) de la base → el nombre con el que el diario llama a la sección. */
const SECCIONES: Record<ArticleSection, string> = {
  [ArticleSection.PORTADA]: 'PORTADA',
  [ArticleSection.TORNEO]: 'TORNEO',
  [ArticleSection.HISTORICA]: 'HISTÓRICA',
  [ArticleSection.MUNDIALITO]: 'MUNDIALITO',
  [ArticleSection.VITRINA]: 'VITRINA',
  [ArticleSection.CLASICOS]: 'CLÁSICOS',
  [ArticleSection.ANTICIPOS]: 'ANTICIPOS',
  [ArticleSection.BREVES]: 'BREVES',
};

const ROLES: Record<PlayerRole, string> = {
  [PlayerRole.HEROE]: 'héroe',
  [PlayerRole.VILLANO]: 'villano',
  [PlayerRole.MENCION]: 'mención',
};

function escribir(texto: string): void {
  process.stdout.write(texto);
}

function regla(caracter: string): string {
  return `${caracter.repeat(ANCHO)}\n`;
}

/**
 * Parte un texto en líneas de a lo sumo `ancho` caracteres sin cortar palabras.
 *
 * Los saltos de línea que ya trae el texto se respetan: son los párrafos que
 * eligió el modelo, y aplastarlos convertiría una nota de dos párrafos en un
 * bloque ilegible.
 */
function envolver(texto: string, ancho: number, sangria = ''): string {
  const lineas: string[] = [];

  for (const parrafo of texto.split('\n')) {
    if (parrafo.trim() === '') {
      lineas.push('');
      continue;
    }

    let actual = '';
    for (const palabra of parrafo.trim().split(/\s+/)) {
      if (actual === '') {
        actual = palabra;
      } else if (`${actual} ${palabra}`.length + sangria.length <= ancho) {
        actual = `${actual} ${palabra}`;
      } else {
        lineas.push(actual);
        actual = palabra;
      }
    }
    if (actual !== '') lineas.push(actual);
  }

  return lineas.map((linea) => (linea === '' ? '' : `${sangria}${linea}`)).join('\n');
}

/** `1234567` → `1.234.567`. Los tokens se cuentan de a millones y sin puntos no se leen. */
function miles(numero: number): string {
  return numero.toLocaleString('es-AR');
}

function dolares(monto: number): string {
  return `USD ${monto.toFixed(2).replace('.', ',')}`;
}

function duracion(ms: number): string {
  const segundos = Math.round(ms / 1000);
  const minutos = Math.floor(segundos / 60);
  return `${minutos} min ${String(segundos % 60).padStart(2, '0')} s (${miles(segundos)} s)`;
}

interface Desglose {
  entrada: number;
  escritura: number;
  lectura: number;
  salida: number;
  total: number;
}

/**
 * El costo de la corrida, con las cuatro patas separadas.
 *
 * Se devuelve el desglose y no solo el total a propósito: cuando una corrida
 * sale cara, lo que hay que saber es CUÁL de las cuatro se disparó. Casi
 * siempre es la lectura de caché — barata por token y enorme en cantidad.
 */
function costo(uso: Generacion, tarifa: { entrada: number; salida: number }): Desglose {
  const entrada = (uso.inputTokens * tarifa.entrada) / 1_000_000;
  const escritura = (uso.cacheWriteTokens * tarifa.entrada * CACHE_ESCRITURA) / 1_000_000;
  const lectura = (uso.cacheReadTokens * tarifa.entrada * CACHE_LECTURA) / 1_000_000;
  const salida = (uso.outputTokens * tarifa.salida) / 1_000_000;

  return {
    entrada,
    escritura,
    lectura,
    salida,
    total: entrada + escritura + lectura + salida,
  };
}

function titulo(texto: string): void {
  escribir(`\n${regla('=')}${texto}\n${regla('=')}`);
}

function subtitulo(texto: string): void {
  escribir(`\n${texto}\n${regla('-')}`);
}

function campo(nombre: string, valor: string): void {
  escribir(`  ${nombre === '' ? ' '.repeat(22) : nombre.padEnd(22, '.')} ${valor}\n`);
}

/** Una nota, maquetada como se lee un diario y no como se lee un JSON. */
function imprimirNota(nota: NotaValidada, numero: number, dossier: Dossier): void {
  escribir(`\n${regla('-')}`);
  escribir(`[${String(numero).padStart(2, '0')}]  ${SECCIONES[nota.seccion]}\n\n`);
  escribir(`${envolver(nota.titular.toUpperCase(), ANCHO)}\n\n`);
  escribir(`${envolver(nota.copete, ANCHO - 2, '  ')}\n\n`);
  escribir(`${envolver(nota.cuerpo, ANCHO)}\n`);

  if (nota.jugadores.length > 0) {
    // El nombre y no el playerId: es lo único que permite juzgar si los roles
    // están bien repartidos. El "desconocido" no debería aparecer nunca —el
    // validador descarta los ids que no existen— pero si aparece, se ve.
    const nombres = nota.jugadores.map((jugador) => {
      const perfil = dossier.estado.jugadores[jugador.playerId];
      return `${perfil?.displayName ?? `desconocido #${jugador.playerId}`} (${ROLES[jugador.rol]})`;
    });
    escribir(`\n${envolver(`→ ${nombres.join(' · ')}`, ANCHO)}\n`);
  }

  escribir(
    `\n   ${nota.titular.length} car. de titular · ${nota.copete.length} de copete · ` +
      `${nota.cuerpo.length} de cuerpo · ${nota.jugadores.length} jugador(es)\n`,
  );
}

/**
 * Lo que el modelo corrió en el sandbox.
 *
 * Se imprime entero y no resumido: es el material con el que se decide si el
 * bloque CÓMO AVERIGUÁS del prompt está funcionando. Un `ls` y dos `print` es
 * un diario que estimó; quince consultas al historial es uno que contó.
 */
function imprimirEjecuciones(ejecuciones: EjecucionDeCodigo[]): void {
  titulo('CÓMO LO AVERIGUÓ — lo que corrió en el sandbox');

  if (ejecuciones.length === 0) {
    escribir(
      '\n  NINGUNA. El modelo escribió la edición sin ejecutar una sola línea de\n' +
        '  código, así que todo número que afirme está estimado a ojo. Eso es una\n' +
        '  falla del prompt, no del modelo.\n',
    );
    return;
  }

  escribir(`\n  ${ejecuciones.length} ejecución(es), en orden.\n`);

  ejecuciones.forEach((ejecucion, indice) => {
    escribir(`\n  ${'-'.repeat(ANCHO - 2)}\n`);
    escribir(`  #${indice + 1}  ${ejecucion.herramienta}\n`);
    escribir(`  $ ${ejecucion.comando}\n`);
    if (ejecucion.contenido !== null) {
      escribir(`\n${envolver(ejecucion.contenido, ANCHO - 4, '    ')}\n`);
    }
  });
}

function imprimirMetricas(
  generacion: Generacion,
  msGeneracion: number,
  msTotal: number,
): void {
  titulo('MÉTRICAS DE LA CORRIDA');

  escribir('\n');
  campo('Modelo', generacion.model);
  campo('Turnos', String(generacion.turnos));
  campo('Ejecuciones de código', String(generacion.ejecuciones.length));
  campo('Duración del modelo', duracion(msGeneracion));
  campo('Duración total', duracion(msTotal));

  escribir('\n');
  campo('Tokens de entrada', miles(generacion.inputTokens));
  campo('Tokens de salida', miles(generacion.outputTokens));
  campo('Caché escrito', miles(generacion.cacheWriteTokens));
  campo('Caché leído', miles(generacion.cacheReadTokens));
  campo(
    'Entrada procesada',
    `${miles(
      generacion.inputTokens + generacion.cacheWriteTokens + generacion.cacheReadTokens,
    )} (los tres de arriba: "tokens de entrada" solo excluye el caché)`,
  );

  const tarifa = TARIFAS[generacion.model];
  if (!tarifa) {
    escribir(`\n  Sin tarifa conocida para ${generacion.model}: no se estima el costo.\n`);
    return;
  }

  const lista = costo(generacion, tarifa);
  escribir('\n');
  campo('COSTO ESTIMADO', `${dolares(lista.total)}   (tarifa de lista)`);
  if (tarifa.promo) {
    const promo = costo(generacion, tarifa.promo);
    campo('', `${dolares(promo.total)}   (promo de lanzamiento, hasta ${tarifa.promo.hasta})`);
  }

  escribir(
    `\n  Desglose a tarifa de lista — USD ${tarifa.entrada} por millón de entrada,\n` +
      `  USD ${tarifa.salida} de salida, caché ${CACHE_ESCRITURA}x al escribir y ` +
      `${CACHE_LECTURA}x al leer:\n\n`,
  );
  campo('  entrada', dolares(lista.entrada));
  campo('  caché escrito', dolares(lista.escritura));
  campo('  caché leído', dolares(lista.lectura));
  campo('  salida', dolares(lista.salida));
}

async function main(): Promise<void> {
  const arranqueTotal = Date.now();

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const builder = app.get(DossierBuilder);
    const cliente = app.get(NewsletterClient);
    const repo = app.get<INewsletterRepository>(NEWSLETTER_REPOSITORY);

    const anterior = await repo.findLastEdition();
    const config = await repo.findConfig();
    const titulares = await repo.findRecentHeadlines();

    // El plan decía `anterior === null`, y no alcanza. Lo único que hace este
    // flag es elegir entre TRABAJO y TRABAJO_INAUGURAL, y TRABAJO le ORDENA al
    // modelo diffear dos fotos: con una edición cargada a mano —o con cualquier
    // fila cuyo snapshot haya quedado en NULL— el diario saldría persiguiendo
    // un "antes" que no existe y reportando cambios fantasma. La pregunta que
    // importa no es si hubo una edición anterior, sino si hay algo con qué
    // compararse.
    const esInaugural = anterior?.snapshot == null;

    titulo('MURIERONNEWS · DRY RUN');
    escribir('\n');
    campo('Diario', config.paperName);
    campo('Modelo', process.env.NEWSLETTER_MODEL ?? 'claude-sonnet-5');
    campo(
      'Lore del grupo',
      config.groupLore ? `${config.groupLore.length} car.` : 'SIN CARGAR',
    );
    campo(
      'Guía de estilo',
      config.styleGuide ? `${config.styleGuide.length} car.` : 'SIN CARGAR',
    );
    campo('Habilitado en la base', config.isEnabled ? 'sí' : 'NO');
    campo(
      'Edición anterior',
      anterior === null
        ? 'ninguna'
        : `#${anterior.editionNumber} del ${anterior.publishedOn} · puntero matchId ` +
            `${anterior.lastMatchId} · snapshot ` +
            (anterior.snapshot ? `v${anterior.snapshotVersion}` : 'NULL'),
    );
    campo(
      'Titulares previos',
      titulares.length > 0 ? titulares.map((t) => `"${t}"`).join(' · ') : 'ninguno',
    );
    campo(
      'Modo',
      esInaugural
        ? 'INAUGURAL — no hay foto anterior que diffear'
        : 'NORMAL — se diffea contra la foto anterior',
    );

    subtitulo('DOSSIER');
    const arranqueDossier = Date.now();
    const dossier = await builder.build(titulares);
    const msDossier = Date.now() - arranqueDossier;

    const serializado = JSON.stringify(dossier);
    const sinteticos = dossier.historial.filter((partido) => !partido.wasTracked).length;
    const jugadores = Object.keys(dossier.estado.jugadores);

    escribir('\n');
    campo(
      'Partidos',
      `${dossier.historial.length} (${sinteticos} sintéticos, sin crónica posible)`,
    );
    campo('Jugadores', String(jugadores.length));
    campo('Con lore cargado', String(Object.keys(dossier.contexto.lorePorJugador).length));
    campo('Catálogo de logros', String(dossier.estado.catalogoLogros.length));
    campo('Torneo en curso', dossier.estado.torneoActivo ? 'sí' : 'no');
    campo('Peso', `${Math.round(serializado.length / 1024)} KB · ${miles(msDossier)} ms`);
    campo('Puntero MAX(matchId)', String(dossier.contexto.ultimoMatchId));
    campo('Fecha del dossier', dossier.contexto.fecha);

    escribir('\nLlamando al modelo. Esto tarda minutos, no segundos.\n');

    const playerIds = new Set(jugadores.map(Number));
    const arranqueGeneracion = Date.now();
    const generacion = await cliente.generar(
      dossier,
      config,
      esInaugural,
      playerIds,
      anterior?.snapshot ?? null,
    );
    const msGeneracion = Date.now() - arranqueGeneracion;

    titulo(`${config.paperName.toUpperCase()} · ${dossier.contexto.fecha}`);
    escribir(`\n${generacion.notas.length} nota(s).\n`);

    generacion.notas.forEach((nota, indice) => imprimirNota(nota, indice + 1, dossier));

    subtitulo('SECCIONES');
    escribir('\n');
    for (const seccion of Object.values(ArticleSection)) {
      const cuantas = generacion.notas.filter((nota) => nota.seccion === seccion).length;
      campo(SECCIONES[seccion], cuantas === 0 ? '—' : String(cuantas));
    }

    imprimirEjecuciones(generacion.ejecuciones);
    imprimirMetricas(generacion, msGeneracion, Date.now() - arranqueTotal);

    escribir(`\n${regla('=')}`);
    escribir('NADA SE ESCRIBIÓ EN LA BASE.\n');
    escribir(
      'Este script solo lee. La edición de arriba existe en esta salida y en\n' +
        'ningún otro lado: ni NewsletterEditions, ni NewsletterArticles, ni el\n' +
        'puntero de partidos se tocaron.\n',
    );
    escribir(regla('='));
  } finally {
    await app.close();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`\nFalló: ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
