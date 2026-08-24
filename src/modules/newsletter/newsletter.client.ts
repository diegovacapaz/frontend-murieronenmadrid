import Anthropic, { toFile } from '@anthropic-ai/sdk';
import { Injectable, Logger } from '@nestjs/common';
import { GlobalsService } from '../../globals/globals.service';
import { validarEdicion } from './helpers/edition.validator';
import type { Dossier, DossierEstado, HistorialPartido } from './interfaces/dossier';
import type { NotaValidada } from './interfaces/validacion';
import { NewsletterGenerationError } from './newsletter.errors';
import { construirSystem } from './newsletter.prompt';
import { PUBLICAR_EDICION_TOOL } from './newsletter.tool';

/**
 * El resultado de una generación que llegó hasta el final.
 *
 * Los cuatro contadores de tokens van juntos porque **solos mienten**.
 * `usage.input_tokens` EXCLUYE lo que se sirvió del caché: la primera corrida
 * real, que procesó 1,76M de tokens de entrada, devolvió `input_tokens: 24`.
 * Guardar ese número como costo sería decir que el diario sale gratis.
 */
export interface Generacion {
  notas: NotaValidada[];
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  /** Cuántas vueltas del bucle hicieron falta hasta publicar. */
  turnos: number;
  /**
   * Lo que el modelo corrió en el sandbox, en orden.
   *
   * No se persiste ni se le muestra a nadie del grupo: existe para el dry-run,
   * que es donde se afina el prompt. Es la única señal directa de si el manual
   * está funcionando — un modelo que abre el historial y cuenta es un diario
   * con números ciertos; uno que ejecuta dos veces y escribe es uno que estimó.
   * Sin esto habría que leer la salida buscando cifras y verificarlas a mano.
   */
  ejecuciones: EjecucionDeCodigo[];
}

/** Una ejecución de código del sandbox, vista desde afuera. */
export interface EjecucionDeCodigo {
  /** `bash_code_execution` o `text_editor_code_execution`. */
  herramienta: string;
  /** El comando de shell, o el `<verbo> <path>` del editor de archivos. */
  comando: string;
  /** El contenido, cuando el editor crea o reemplaza un archivo. */
  contenido: string | null;
}

/** El beta que habilita la Files API. Va en el upload Y en cada mensaje. */
const BETA_FILES = 'files-api-2025-04-14';

/**
 * Todo lo que sabe hablar con la API de Anthropic. El resto del módulo no
 * importa el SDK.
 *
 * ## El bucle
 *
 * La herramienta `code_execution` corre del lado de Anthropic: el sandbox nace
 * y muere dentro de la request y en nuestro servidor no se instala nada. Lo que
 * expone —visto en las corridas reales— es `bash_code_execution` y
 * `text_editor_code_execution`: una shell y un editor de archivos, con Python
 * adentro. Pero cuando el modelo se toma varios turnos ejecutando código, la
 * API corta con `stop_reason: 'pause_turn'` y hay que reenviar el historial
 * para que siga. De ahí el while.
 *
 * El tope de vueltas existe para que un modelo que se entusiasme explorando no
 * gaste indefinidamente. Si se agota sin que llamara a publicarEdicion, se
 * trata como fallo: no hay edición y el puntero no se mueve.
 *
 * ## Por qué el historial viaja como archivo y no adentro del mensaje
 *
 * El sandbox NO ve la conversación. Con todo el dossier en el mensaje, la única
 * forma que tenía el modelo de "contarlo con código" era escribirlo a un
 * archivo TIPEÁNDOLO como tokens de salida — y eso se midió: 45.354 caracteres
 * de historial tecleados a mano, ~45k de los 54.562 tokens de salida de la
 * corrida, USD 0,45 por edición y creciendo con el grupo. La corrida anterior,
 * con `max_tokens` en 16000, directamente murió en la mitad de ese tecleo.
 *
 * Así que el historial sube por la Files API y entra al sandbox como un bloque
 * `container_upload`: el modelo lo abre con `json.load` y no tipea nada. El
 * resto del dossier —estado, snapshot anterior, lore, titulares— SE QUEDA en el
 * mensaje a propósito: es lo que el modelo lee para decidir de qué escribir, y
 * mandarlo también al archivo lo obligaría a abrir un archivo para todo.
 *
 * ## El caché, que es la mayor parte del costo
 *
 * `system` y `tools` son idénticos en los doce turnos, y el mensaje de usuario
 * se arma UNA vez antes del bucle y no se vuelve a tocar. El orden importa: el
 * `container_upload` va primero y el texto del dossier último, con el
 * `cache_control` en él, así que todo lo estable queda del lado cacheado del
 * corte y lo único que se agrega después son los turnos del modelo.
 *
 * Y rinde mucho más de lo que decía el plan, porque no rinde entre turnos sino
 * DENTRO de cada uno: la corrida anterior publicó en un solo turno y ese turno
 * leyó 1.595.682 tokens de caché contra 24 de entrada sin cachear. El bucle
 * interno de la herramienta de servidor vuelve a mandar el prefijo en cada
 * ejecución de código, y cada relectura cuesta el 10%.
 *
 * La regla que hace que todo esto funcione: el dossier se serializa una sola
 * vez. Volver a serializar el mismo objeto puede cambiar el orden de las
 * claves, y un solo byte distinto en el prefijo invalida todo lo que viene
 * después sin que nadie se entere. Por eso `construirSystem` también sale del
 * bucle: no es micro-optimización, es que el string tiene que ser EL MISMO.
 */
@Injectable()
export class NewsletterClient {
  private readonly logger = new Logger(NewsletterClient.name);
  private readonly anthropic: Anthropic;
  private readonly model: string;

  private static readonly MAX_TURNOS = 12;

  /** El nombre con el que el prompt le dice al modelo que busque el archivo. */
  private static readonly ARCHIVO_HISTORIAL = 'historial.json';

  /**
   * Techo de salida por turno.
   *
   * **No son los 16000 del plan, y el motivo está medido.** Con 16000 la
   * primera corrida real contra la base entera murió en el turno 1 con
   * `stop_reason: 'max_tokens'` a los 107 segundos, en la mitad de un
   * `text_editor_code_execution create`. Un bloque `tool_use` cortado por
   * `max_tokens` no se puede continuar —el JSON queda a la mitad y reenviarlo
   * es un 400—, así que no es una corrida más cara: es una corrida perdida.
   *
   * Con el historial ya adentro del sandbox el modelo no tiene que tipear nada
   * y la salida esperada es mucho menor, pero el techo se queda alto: lo que
   * cuida la plata es `MAX_TOKENS_SALIDA`, y un `max_tokens` corto no ahorra
   * nada, solo rompe.
   */
  private static readonly MAX_TOKENS_POR_TURNO = 64_000;

  /**
   * Techo de salida de la generación ENTERA, que es el que cuida la plata.
   *
   * `MAX_TURNOS` sola dejó de alcanzar cuando el turno pasó a valer 64000: doce
   * turnos al tope son 768k tokens de salida, unos USD 7,68 para una edición
   * presupuestada en 0,63. Este corte hace que el peor caso sea conocido sin
   * recortarle al modelo el turno largo que sí necesita para escribir.
   */
  private static readonly MAX_TOKENS_SALIDA = 150_000;

  /**
   * Deadline de pared.
   *
   * Ni los turnos ni los tokens acotan el TIEMPO, y se midió un turno de 8
   * minutos y 38 segundos. Doce así son más de hora y media colgado de un cron
   * que corre a las cinco de la mañana, tapando la ventana de un reintento.
   * Veinte minutos es holgado para tres o cuatro turnos honestos y corta antes
   * de que el diario deje de tener sentido.
   */
  private static readonly DEADLINE_MS = 20 * 60 * 1000;

  constructor(private readonly globals: GlobalsService) {
    this.anthropic = new Anthropic({ apiKey: this.globals.get('ANTHROPIC_API_KEY') });
    this.model = this.globals.get('NEWSLETTER_MODEL');
  }

  async generar(
    dossier: Dossier,
    config: { paperName: string; groupLore: string | null; styleGuide: string | null },
    esInaugural: boolean,
    playerIdsValidos: Set<number>,
    snapshotAnterior: DossierEstado | null,
  ): Promise<Generacion> {
    const fileId = await this.subirHistorial(dossier.historial);

    try {
      return await this.conversar(
        dossier,
        config,
        esInaugural,
        playerIdsValidos,
        snapshotAnterior,
        fileId,
      );
    } finally {
      // El archivo se borra pase lo que pase. Uno por edición, todos los días,
      // es basura que se acumula en una cuenta que nadie mira. Y el borrado no
      // puede tapar el error de arriba: si falla, se loguea y listo.
      await this.anthropic.beta.files
        .delete(fileId, { betas: [BETA_FILES] })
        .catch((error: unknown) =>
          this.logger.warn(`No se pudo borrar el archivo ${fileId}: ${String(error)}`),
        );
    }
  }

  /**
   * El historial, a la Files API.
   *
   * Se serializa acá y en ningún otro lado: el mensaje ya no lo lleva.
   */
  private async subirHistorial(historial: HistorialPartido[]): Promise<string> {
    const json = JSON.stringify(historial);
    const archivo = await this.anthropic.beta.files.upload({
      file: await toFile(Buffer.from(json, 'utf8'), NewsletterClient.ARCHIVO_HISTORIAL, {
        type: 'application/json',
      }),
      betas: [BETA_FILES],
    });

    this.logger.log(
      `Historial subido como ${archivo.id}: ${historial.length} partidos, ${json.length} chars`,
    );

    return archivo.id;
  }

  private async conversar(
    dossier: Dossier,
    config: { paperName: string; groupLore: string | null; styleGuide: string | null },
    esInaugural: boolean,
    playerIdsValidos: Set<number>,
    snapshotAnterior: DossierEstado | null,
    fileId: string,
  ): Promise<Generacion> {
    // Las partes estables, armadas una sola vez. Ver el docstring: no se
    // recalculan adentro del bucle porque tienen que ser byte por byte iguales
    // en todos los turnos o el caché no pega.
    const system = construirSystem(config, esInaugural);
    const tools: Anthropic.Beta.BetaToolUnion[] = [
      { type: 'code_execution_20260120', name: 'code_execution' },
      PUBLICAR_EDICION_TOOL,
    ];

    // El orden de los dos bloques es la mitad del ahorro: el archivo primero, el
    // dossier último y con el `cache_control` en él. Todo lo estable queda del
    // lado cacheado; lo único que cambia entre turnos —el código que el modelo
    // escribe y su resultado— se agrega DESPUÉS y no invalida el prefijo.
    const messages: Anthropic.Beta.BetaMessageParam[] = [
      {
        role: 'user',
        content: [
          { type: 'container_upload', file_id: fileId },
          {
            type: 'text',
            text: this.armarMensaje(dossier, snapshotAnterior),
            cache_control: { type: 'ephemeral' },
          },
        ],
      },
    ];

    const arranque = Date.now();
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheWriteTokens = 0;
    let cacheReadTokens = 0;
    const ejecuciones: EjecucionDeCodigo[] = [];
    let yaReintento = false;

    for (let turno = 0; turno < NewsletterClient.MAX_TURNOS; turno += 1) {
      // Los dos presupuestos se chequean acá arriba y no adentro de una rama:
      // así valen para TODOS los caminos que siguen el bucle, el `pause_turn` y
      // el reintento de una edición inválida por igual.
      if (turno > 0) this.chequearPresupuesto(turno, outputTokens, arranque);

      // Streaming, y no `create`, por dos razones que las corridas reales
      // dejaron claras: el SDK lo exige para un `max_tokens` de este tamaño, y
      // un turno con ejecución de código tarda minutos —se midió uno de 517
      // segundos— contra un request HTTP que sin stream se puede cortar por
      // timeout y hacer que el SDK lo reintente, pagando el dossier de nuevo.
      const response = await this.anthropic.beta.messages
        .stream({
          model: this.model,
          max_tokens: NewsletterClient.MAX_TOKENS_POR_TURNO,
          thinking: { type: 'adaptive' },
          betas: [BETA_FILES],
          system,
          tools,
          messages,
        })
        .finalMessage();

      inputTokens += response.usage.input_tokens;
      outputTokens += response.usage.output_tokens;
      cacheWriteTokens += response.usage.cache_creation_input_tokens ?? 0;
      cacheReadTokens += response.usage.cache_read_input_tokens ?? 0;
      // `includes` y no `=== 'code_execution'`: la herramienta se declara con
      // ese nombre pero los bloques que devuelve vienen con el nombre del
      // sub-comando —`bash_code_execution` y `text_editor_code_execution`—, así
      // que la comparación exacta cuenta siempre cero.
      for (const bloque of response.content) {
        if (bloque.type === 'server_tool_use' && bloque.name.includes('code_execution')) {
          ejecuciones.push(NewsletterClient.aEjecucion(bloque));
        }
      }

      this.logger.log(
        `Turno ${turno + 1}/${NewsletterClient.MAX_TURNOS}: ${response.stop_reason ?? 'sin stop_reason'} · ` +
          `in ${response.usage.input_tokens} · out ${response.usage.output_tokens} · ` +
          `cache_w ${response.usage.cache_creation_input_tokens ?? 0} · ` +
          `cache_r ${response.usage.cache_read_input_tokens ?? 0}`,
      );

      // El modelo llego al limite de iteraciones de la herramienta del servidor.
      // Se devuelve el turno y se sigue.
      if (response.stop_reason === 'pause_turn') {
        messages.push({ role: 'assistant', content: response.content });
        continue;
      }

      const publicar = response.content.find(
        (bloque): bloque is Anthropic.Beta.BetaToolUseBlock =>
          bloque.type === 'tool_use' && bloque.name === 'publicarEdicion',
      );

      if (publicar) {
        const validado = validarEdicion(publicar.input, playerIdsValidos);

        if (validado.ok) {
          this.avisarSiElCacheNoPego(turno, cacheReadTokens);
          this.logger.log(
            `Edición generada en ${turno + 1} turno(s): ${validado.notas.length} notas, ` +
              `${ejecuciones.length} ejecución(es) de código · ` +
              `in ${inputTokens} · out ${outputTokens} · ` +
              `cache_w ${cacheWriteTokens} · cache_r ${cacheReadTokens}`,
          );

          return {
            notas: validado.notas,
            model: this.model,
            inputTokens,
            outputTokens,
            cacheWriteTokens,
            cacheReadTokens,
            turnos: turno + 1,
            ejecuciones,
          };
        }

        // La edición no pasó la validación. Tirarla acá sería tirar también los
        // minutos y los dólares del turno que la produjo, y el motivo casi
        // siempre es una regla que ningún schema puede expresar —dos portadas,
        // ninguna— que el modelo corrige en un mensaje. Con el prefijo ya
        // cacheado, dejarlo corregir cuesta centavos.
        //
        // UN solo reintento. Un bucle de reintentos sobre un modelo que no
        // entendió la regla es una forma cara de fallar igual.
        if (yaReintento) {
          throw new NewsletterGenerationError(
            `Edicion invalida despues del reintento: ${validado.motivo}`,
          );
        }

        yaReintento = true;
        this.logger.warn(
          `Edición inválida (${validado.motivo}). Se le devuelve el motivo para que corrija.`,
        );

        messages.push({ role: 'assistant', content: response.content });
        // La respuesta lleva SOLO el tool_result, sin texto: es lo que la API
        // pide cuando hay una llamada a herramienta pendiente. Y va después del
        // corte del caché, así que no toca el prefijo.
        messages.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: publicar.id,
              is_error: true,
              content:
                `La edición no se publicó: ${validado.motivo}. ` +
                'Corregí eso y volvé a llamar a publicarEdicion UNA sola vez, con todas ' +
                'las notas juntas. No hace falta que rehagas los cálculos: ya están hechos.',
            },
          ],
        });
        continue;
      }

      // Termino el turno sin publicar: no hay nada que hacer con eso.
      if (response.stop_reason === 'end_turn') {
        throw new NewsletterGenerationError('El modelo termino sin llamar a publicarEdicion');
      }

      // Cualquier otra cosa es un final que no sabemos continuar, y reenviar el
      // historial sería peor que fallar acá.
      //
      // El bucle solo puede seguir con `pause_turn` o con el reintento de una
      // edición inválida: `code_execution` es una herramienta del servidor, la
      // resuelve Anthropic dentro del turno y su resultado ya viene en el
      // content, así que nunca deja un tool_use pendiente. Un
      // `stop_reason: 'tool_use'` que no sea publicarEdicion es una herramienta
      // nuestra sin resolver, y reenviarla sin su tool_result es un 400.
      // `max_tokens` deja el último bloque cortado a la mitad y reenviarlo es
      // otro 400. `refusal` y `model_context_window_exceeded` no mejoran
      // repitiendo. En los cuatro casos el bucle gastaría plata para terminar
      // fallando igual, once turnos después.
      throw new NewsletterGenerationError(
        `El modelo cortó con stop_reason '${response.stop_reason ?? 'null'}' en el turno ${turno + 1}`,
      );
    }

    // El aviso del caché va también acá, y no solo en el camino feliz: la
    // corrida que agotó los doce turnos es justamente la más cara y la que más
    // ganas de saberlo tiene.
    this.avisarSiElCacheNoPego(NewsletterClient.MAX_TURNOS - 1, cacheReadTokens);

    throw new NewsletterGenerationError(
      `Se agotaron los ${NewsletterClient.MAX_TURNOS} turnos sin publicar`,
    );
  }

  /**
   * Un `server_tool_use` del sandbox, aplanado a algo imprimible.
   *
   * El `input` viene como `unknown` y su forma depende del sub-comando: la
   * shell trae `command` con la línea entera, y el editor trae `command` con el
   * verbo (`create`, `view`, `str_replace`), `path` con el archivo y a veces
   * `file_text` con el contenido. Se leen con acceso indexado y sin asumir
   * ninguna: un campo que no está queda en cadena vacía, no rompe la corrida.
   *
   * El contenido se recorta: un script de análisis entra holgado en 6000
   * caracteres y lo que pase de ahí es un archivo de datos que nadie va a leer.
   */
  private static aEjecucion(bloque: Anthropic.Beta.BetaServerToolUseBlock): EjecucionDeCodigo {
    const input = (bloque.input ?? {}) as Record<string, unknown>;
    const verbo = typeof input.command === 'string' ? input.command : '';
    const path = typeof input.path === 'string' ? input.path : '';
    const texto = typeof input.file_text === 'string' ? input.file_text : null;

    return {
      herramienta: bloque.name,
      comando: [verbo, path].filter((parte) => parte !== '').join(' '),
      contenido: texto === null ? null : texto.slice(0, 6000),
    };
  }

  /**
   * Los dos cortes que `MAX_TURNOS` no cubre: la plata y el reloj.
   *
   * Se chequean DESPUÉS del turno que los pasó y no antes: cortar a mitad de
   * camino no devuelve lo que ya se pagó, y si ese turno publicó, la edición
   * vale y ni siquiera se llega hasta acá.
   */
  private chequearPresupuesto(turno: number, outputTokens: number, arranque: number): void {
    if (outputTokens >= NewsletterClient.MAX_TOKENS_SALIDA) {
      throw new NewsletterGenerationError(
        `Se pasó del techo de ${NewsletterClient.MAX_TOKENS_SALIDA} tokens de salida ` +
          `(${outputTokens}) en ${turno} turnos sin publicar`,
      );
    }

    const transcurrido = Date.now() - arranque;
    if (transcurrido >= NewsletterClient.DEADLINE_MS) {
      throw new NewsletterGenerationError(
        `Se pasó del deadline de ${NewsletterClient.DEADLINE_MS / 60000} minutos ` +
          `(${Math.round(transcurrido / 1000)}s) en ${turno} turnos sin publicar`,
      );
    }
  }

  /**
   * Si el caché no pegó ni una vez, el prefijo se está invalidando entre turnos
   * y estamos pagando el 25% de la escritura a cambio de nada. Con más de un
   * turno tiene que haber lecturas.
   */
  private avisarSiElCacheNoPego(turno: number, cacheReadTokens: number): void {
    if (turno > 0 && cacheReadTokens === 0) {
      this.logger.warn(`El cache no pego en ${turno + 1} turnos: algo invalida el prefijo`);
    }
  }

  /**
   * El mensaje de usuario: una línea de contexto en prosa y las fotos del
   * sistema. **El historial ya no está acá**: viaja como archivo al sandbox.
   *
   * La prosa no es decoración. El modelo va a diffear dos objetos de decenas de
   * miles de tokens, y arrancar sabiendo qué día es, cuántos partidos trae la
   * última jornada y si las dos fotos son comparables le ahorra tres consultas
   * al sandbox y evita el error caro: reportar cambios fantasma cuando lo que
   * cambió fue la forma del dossier y no la realidad.
   *
   * Sobre "la última jornada": el puntero de la edición anterior no llega hasta
   * acá —no está en la firma y no está en el dossier—, así que lo que se cuenta
   * es lo que sí es derivable, los partidos del último día con partidos. Es lo
   * mismo el 99% de las veces; el día que el cron falle y reintente, va a haber
   * material nuevo de más de una jornada y el número va a quedar corto. Por eso
   * la línea dice de qué día son los partidos que cuenta, en vez de afirmar que
   * son "los nuevos": el modelo tiene el historial completo y las dos fotos
   * para encontrar el resto, y una cifra honesta vale más que una redonda.
   */
  private armarMensaje(dossier: Dossier, snapshotAnterior: DossierEstado | null): string {
    const ultimoDia = dossier.historial.at(-1)?.playedAt.slice(0, 10) ?? null;
    const deLaUltimaJornada = ultimoDia
      ? dossier.historial.filter((partido) => partido.playedAt.startsWith(ultimoDia)).length
      : 0;

    const jornada =
      ultimoDia === null
        ? 'El historial está vacío: no hay un solo partido cargado.'
        : `El historial tiene ${dossier.historial.length} partidos en total y el último ` +
          `día con partidos es el ${ultimoDia}, con ${deLaUltimaJornada}.`;

    const snapshot =
      snapshotAnterior === null
        ? 'No hay foto anterior: esta es la primera edición y no hay nada que diffear.'
        : snapshotAnterior.version === dossier.estado.version
          ? `La foto anterior es de la misma versión de dossier (${dossier.estado.version}): ` +
            'las dos son comparables campo a campo y la noticia está en la diferencia.'
          : `ATENCIÓN: la foto anterior es de la versión ${snapshotAnterior.version} y la de ` +
            `hoy es de la ${dossier.estado.version}. Cambió la FORMA de los datos, no la ` +
            'realidad. No las compares campo a campo: escribí la edición sobre el estado de ' +
            'hoy y sobre el historial.';

    // Serializado UNA sola vez, acá y en ningún otro lado. Este string es el
    // prefijo cacheado de los doce turnos.
    //
    // Las claves NO son libres: `estado` y `contexto` son los nombres con los
    // que el system prompt le enseña a leer el dossier ("estado.general",
    // "estado.jugadores", "estado.catalogoLogros"). Si acá se llamaran distinto,
    // el manual estaría describiendo un objeto que no existe. La única clave que
    // el prompt no nombra es la foto de ayer, que va como `estadoAnterior` y con
    // la misma forma exacta, que es lo que hace que diffearlas sea recorrer las
    // mismas claves.
    //
    // Y `historial` NO está: es el archivo del sandbox.
    const fotos = JSON.stringify({
      estado: dossier.estado,
      estadoAnterior: snapshotAnterior,
      contexto: dossier.contexto,
    });

    return (
      `Hoy es ${dossier.contexto.fecha}. ${jornada} ${snapshot}\n\n` +
      'El historial completo de partidos NO va en este mensaje: está adjunto al sandbox ' +
      `como \`${NewsletterClient.ARCHIVO_HISTORIAL}\`, listo para abrir con json.load. Es ` +
      'la lista de partidos del más viejo al más nuevo, con la forma que describe el ' +
      'manual. No lo copies ni lo vuelvas a escribir: ya está ahí.\n\n' +
      'Abajo va el resto, como un único objeto JSON: `estado` es la foto del sistema de ' +
      'este momento, `estadoAnterior` es la de la edición pasada con la misma forma exacta ' +
      'y `contexto` trae la fecha, las notas escritas a mano y los titulares que ya se ' +
      'publicaron.\n\n' +
      fotos
    );
  }
}
