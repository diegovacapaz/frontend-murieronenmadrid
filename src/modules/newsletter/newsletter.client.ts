import Anthropic from '@anthropic-ai/sdk';
import { Injectable, Logger } from '@nestjs/common';
import { GlobalsService } from '../../globals/globals.service';
import { validarEdicion } from './helpers/edition.validator';
import type { Dossier, DossierEstado } from './interfaces/dossier';
import type { NotaValidada } from './interfaces/validacion';
import { NewsletterGenerationError } from './newsletter.errors';
import { construirSystem } from './newsletter.prompt';
import { PUBLICAR_EDICION_TOOL } from './newsletter.tool';

/** El resultado de una generación que llegó hasta el final. */
export interface Generacion {
  notas: NotaValidada[];
  model: string;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Todo lo que sabe hablar con la API de Anthropic. El resto del módulo no
 * importa el SDK.
 *
 * ## El bucle
 *
 * La herramienta `code_execution` corre del lado de Anthropic: el sandbox nace
 * y muere dentro de la request y en nuestro servidor no se instala nada. Lo que
 * expone —visto en la primera corrida real— es `bash_code_execution` y
 * `text_editor_code_execution`: una shell y un editor de archivos, con Python
 * adentro. Pero cuando el modelo se toma varios turnos ejecutando código, la
 * API corta con `stop_reason: 'pause_turn'` y hay que reenviar el historial
 * para que siga. De ahí el while.
 *
 * Y una consecuencia que conviene tener presente: el sandbox NO ve la
 * conversación. El dossier viaja en el mensaje de usuario, no en un archivo, así
 * que para contarlo con código el modelo primero tiene que escribirlo a un
 * archivo —tipeándolo como tokens de salida—. Con un dossier de 112k tokens eso
 * es caro y es lo que reventó `max_tokens` en la primera corrida.
 *
 * El tope de vueltas existe para que un modelo que se entusiasme explorando no
 * gaste indefinidamente. Si se agota sin que llamara a publicarEdicion, se
 * trata como fallo: no hay edición y el puntero no se mueve.
 *
 * ## El caché, que es la mitad del costo
 *
 * `system` y `tools` son idénticos en los doce turnos, y el mensaje de usuario
 * —el dossier entero— se arma UNA vez antes del bucle y no se vuelve a tocar.
 * Con el `cache_control` en su último bloque, todo eso queda del lado cacheado
 * del corte y lo único que se agrega después son los turnos del modelo.
 *
 * Y rinde mucho más de lo que decía el plan, porque no rinde entre turnos sino
 * DENTRO de cada uno: la corrida real publicó en un solo turno y ese turno leyó
 * 1.595.682 tokens de caché contra 24 de entrada sin cachear. El bucle interno
 * de la herramienta de servidor vuelve a mandar el prefijo en cada iteración
 * —once ejecuciones de código, once relecturas de los ~112k tokens del
 * dossier—, y cada una de esas relecturas cuesta el 10%. Sin `cache_control`
 * esa misma corrida pagaba 1,6M de tokens de entrada a precio lleno: unos USD
 * 3,2 en vez de 0,32. El caché no es el 50% del costo, es el 80%.
 *
 * La regla que hace que funcione: el dossier se serializa una sola vez. Volver
 * a serializar el mismo objeto puede cambiar el orden de las claves, y un solo
 * byte distinto en el prefijo invalida todo lo que viene después sin que nadie
 * se entere. Por eso `construirSystem` también sale del bucle: no es
 * micro-optimización, es que el string tiene que ser EL MISMO.
 */
@Injectable()
export class NewsletterClient {
  private readonly logger = new Logger(NewsletterClient.name);
  private readonly anthropic: Anthropic;
  private readonly model: string;

  private static readonly MAX_TURNOS = 12;

  /**
   * Techo de salida por turno.
   *
   * **No son los 16000 del plan, y el motivo está medido.** Con 16000 la
   * primera corrida real contra la base entera (68 partidos, 27 jugadores, un
   * dossier de 112k tokens) murió en el turno 1 con `stop_reason: 'max_tokens'`
   * a los 107 segundos, en la mitad de un `text_editor_code_execution create`:
   * el modelo estaba escribiendo el dossier a un archivo del sandbox para
   * poder contarlo con código, que es exactamente lo que el prompt le pide, y
   * eso no entra en 16000 tokens de salida.
   *
   * Un bloque `tool_use` cortado por `max_tokens` no se puede continuar —el
   * JSON queda a la mitad y reenviarlo es un 400—, así que no es una corrida
   * más cara: es una corrida perdida. Por eso el número sube.
   */
  private static readonly MAX_TOKENS_POR_TURNO = 64_000;

  /**
   * Techo de salida de la generación ENTERA, que es el que cuida la plata.
   *
   * `MAX_TURNOS` sola dejó de alcanzar cuando el turno pasó a valer 64000: doce
   * turnos al tope son 768k tokens de salida, unos USD 7,68, para una edición
   * presupuestada en 0,63. Este corte hace que el peor caso sea conocido —150k
   * de salida son unos USD 1,50— sin recortarle al modelo el turno largo que sí
   * necesita para escribir.
   *
   * Se chequea DESPUÉS de cada turno y no antes: cortar a mitad de camino no
   * devuelve la plata del turno que ya se pagó, y si ese turno publicó, la
   * edición vale.
   */
  private static readonly MAX_TOKENS_SALIDA = 150_000;

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
    // Las tres partes estables, armadas una sola vez. Ver el docstring: no se
    // recalculan adentro del bucle porque tienen que ser byte por byte iguales
    // en todos los turnos o el caché no pega.
    const system = construirSystem(config, esInaugural);
    const tools: Anthropic.ToolUnion[] = [
      { type: 'code_execution_20260120', name: 'code_execution' },
      PUBLICAR_EDICION_TOOL,
    ];

    // El dossier va como UN bloque con cache_control al final. Todo lo estable
    // —system, herramientas y este bloque— queda del lado cacheado; lo único
    // que cambia entre turnos (el código que el modelo escribe y su resultado)
    // se agrega DESPUÉS, así que no invalida el prefijo.
    const messages: Anthropic.MessageParam[] = [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: this.armarMensaje(dossier, snapshotAnterior),
            cache_control: { type: 'ephemeral' },
          },
        ],
      },
    ];

    let inputTokens = 0;
    let outputTokens = 0;
    let cacheWrites = 0;
    let cacheReads = 0;
    let ejecucionesDeCodigo = 0;

    for (let turno = 0; turno < NewsletterClient.MAX_TURNOS; turno += 1) {
      // Streaming, y no `messages.create`, por dos razones que la corrida real
      // dejó claras: el SDK exige stream para un `max_tokens` de este tamaño, y
      // un turno con ejecución de código tarda minutos —el primero de la
      // primera corrida tardó 107 segundos— contra un request HTTP que sin
      // stream se puede cortar por timeout y hacer que el SDK lo reintente,
      // pagando el dossier entero de nuevo. La respuesta que devuelve
      // `finalMessage()` es el mismo `Message` de siempre: el bucle no cambia.
      const response = await this.anthropic.messages
        .stream({
          model: this.model,
          max_tokens: NewsletterClient.MAX_TOKENS_POR_TURNO,
          thinking: { type: 'adaptive' },
          system,
          tools,
          messages,
        })
        .finalMessage();

      inputTokens += response.usage.input_tokens;
      outputTokens += response.usage.output_tokens;
      cacheWrites += response.usage.cache_creation_input_tokens ?? 0;
      cacheReads += response.usage.cache_read_input_tokens ?? 0;
      // `includes` y no `=== 'code_execution'`: la herramienta se declara con
      // ese nombre pero los bloques que devuelve vienen con el nombre del
      // sub-comando —`bash_code_execution` y `text_editor_code_execution`—, así
      // que la comparación exacta cuenta siempre cero. Medido en la corrida
      // real: once bloques, diez de bash y uno del editor.
      ejecucionesDeCodigo += response.content.filter(
        (bloque) => bloque.type === 'server_tool_use' && bloque.name.includes('code_execution'),
      ).length;

      this.logger.log(
        `Turno ${turno + 1}/${NewsletterClient.MAX_TURNOS}: ${response.stop_reason ?? 'sin stop_reason'} · ` +
          `in ${response.usage.input_tokens} · out ${response.usage.output_tokens} · ` +
          `cache_w ${response.usage.cache_creation_input_tokens ?? 0} · ` +
          `cache_r ${response.usage.cache_read_input_tokens ?? 0}`,
      );

      // El modelo llego al limite de iteraciones de la herramienta del servidor.
      // Se devuelve el turno y se sigue.
      if (response.stop_reason === 'pause_turn') {
        if (outputTokens >= NewsletterClient.MAX_TOKENS_SALIDA) {
          throw new NewsletterGenerationError(
            `Se pasó del techo de ${NewsletterClient.MAX_TOKENS_SALIDA} tokens de salida ` +
              `(${outputTokens}) en ${turno + 1} turnos sin publicar`,
          );
        }
        messages.push({ role: 'assistant', content: response.content });
        continue;
      }

      const publicar = response.content.find(
        (bloque): bloque is Anthropic.ToolUseBlock =>
          bloque.type === 'tool_use' && bloque.name === 'publicarEdicion',
      );

      if (publicar) {
        const validado = validarEdicion(publicar.input, playerIdsValidos);
        if (!validado.ok) {
          throw new NewsletterGenerationError(`Edicion invalida: ${validado.motivo}`);
        }

        this.avisarSiElCacheNoPego(turno, cacheReads);
        this.logger.log(
          `Edición generada en ${turno + 1} turno(s): ${validado.notas.length} notas, ` +
            `${ejecucionesDeCodigo} ejecución(es) de código · ` +
            `in ${inputTokens} · out ${outputTokens} · ` +
            `cache_w ${cacheWrites} · cache_r ${cacheReads}`,
        );

        return { notas: validado.notas, model: this.model, inputTokens, outputTokens };
      }

      // Termino el turno sin publicar: no hay nada que hacer con eso.
      if (response.stop_reason === 'end_turn') {
        throw new NewsletterGenerationError('El modelo termino sin llamar a publicarEdicion');
      }

      // Cualquier otra cosa es un final que no sabemos continuar, y reenviar el
      // historial sería peor que fallar acá.
      //
      // El bucle solo puede seguir con `pause_turn`: `code_execution` es una
      // herramienta del servidor, la resuelve Anthropic dentro del turno y su
      // resultado ya viene en el content, así que nunca deja un tool_use
      // pendiente. Un `stop_reason: 'tool_use'` que no sea publicarEdicion es
      // una herramienta nuestra sin resolver, y reenviarla sin su tool_result
      // es un 400. `max_tokens` deja el último bloque cortado a la mitad y
      // reenviarlo es otro 400. `refusal` y `model_context_window_exceeded` no
      // mejoran repitiendo. En los cuatro casos el bucle gastaría plata para
      // terminar fallando igual, doce veces.
      throw new NewsletterGenerationError(
        `El modelo cortó con stop_reason '${response.stop_reason ?? 'null'}' en el turno ${turno + 1}`,
      );
    }

    // El aviso del caché va también acá, y no solo en el camino feliz: la
    // corrida que agotó los doce turnos es justamente la más cara y la que más
    // ganas de saberlo tiene.
    this.avisarSiElCacheNoPego(NewsletterClient.MAX_TURNOS - 1, cacheReads);

    throw new NewsletterGenerationError(
      `Se agotaron los ${NewsletterClient.MAX_TURNOS} turnos sin publicar`,
    );
  }

  /**
   * Si el caché no pegó ni una vez, el prefijo se está invalidando entre turnos
   * y estamos pagando el 25% de la escritura a cambio de nada. Con más de un
   * turno tiene que haber lecturas.
   */
  private avisarSiElCacheNoPego(turno: number, cacheReads: number): void {
    if (turno > 0 && cacheReads === 0) {
      this.logger.warn(`El cache no pego en ${turno + 1} turnos: algo invalida el prefijo`);
    }
  }

  /**
   * El mensaje de usuario: una línea de contexto en prosa y las dos fotos.
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
    // Las claves NO son libres: `estado`, `historial` y `contexto` son los
    // nombres con los que el system prompt le enseña a leer el dossier
    // ("estado.general", "estado.jugadores", "estado.catalogoLogros"). Si acá
    // se llamaran distinto, el manual estaría describiendo un objeto que no
    // existe. La única clave que el prompt no nombra es la foto de ayer, que va
    // como `estadoAnterior` y con la misma forma exacta, que es lo que hace que
    // diffearlas sea recorrer las mismas claves.
    const fotos = JSON.stringify({
      estado: dossier.estado,
      estadoAnterior: snapshotAnterior,
      historial: dossier.historial,
      contexto: dossier.contexto,
    });

    return (
      `Hoy es ${dossier.contexto.fecha}. ${jornada} ${snapshot}\n\n` +
      'Abajo va todo lo que tenés, como un único objeto JSON: `estado` es la foto del ' +
      'sistema de este momento, `estadoAnterior` es la de la edición pasada con la misma ' +
      'forma exacta, `historial` son todos los partidos del más viejo al más nuevo y ' +
      '`contexto` trae la fecha, las notas escritas a mano y los titulares que ya se ' +
      'publicaron.\n\n' +
      fotos
    );
  }
}
