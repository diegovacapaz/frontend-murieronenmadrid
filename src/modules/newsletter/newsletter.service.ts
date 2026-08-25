import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AppErrorCode } from '../../common/constants/error-codes.constants';
import { RealtimeEvent } from '../../realtime/realtime.events';
import { RealtimeService } from '../../realtime/realtime.service';
import { DossierBuilder } from './dossier.builder';
import { EditionResponseDto, EditionSummaryDto } from './dto/edition-response.dto';
import type { UpdateArticleDto } from './dto/update-article.dto';
import type { UpdateConfigDto } from './dto/update-config.dto';
import type { Article, Edition, LastEdition, NewsletterConfigRow } from './entities/edition.entity';
import { fechaDeHoy } from './helpers/fecha';
import type { Dossier } from './interfaces/dossier';
import type {
  DatosEdicion,
  INewsletterRepository,
} from './interfaces/newsletter.repository.interface';
import type { Generacion } from './newsletter.client';
import { NewsletterClient } from './newsletter.client';
import { NEWSLETTER_REPOSITORY } from './newsletter.constants';

/**
 * El guard del cron. Lo primero que se ejecuta a las cinco de la mañana.
 *
 * Es una comparación de enteros contra un `SELECT MAX(matchId)`, o sea un
 * milisegundo. Todo lo caro —las ~60 llamadas a procedures, el dossier de 200
 * KB, la llamada a la API que sale USD 1,42— pasa DESPUÉS de esto y sólo si
 * devuelve true.
 *
 * El caso del puntero adelantado (alguien borró el último partido) devuelve
 * false a propósito: no hay material nuevo, y no es un error.
 *
 * Va exportada aparte de la clase porque es lógica pura: entra un par de
 * enteros, sale un booleano. Así se testea sin levantar el contenedor de Nest,
 * que es lo único que el runner de este proyecto no puede hacer.
 */
export function hayNovedades(
  maxMatchId: number | null,
  lastMatchId: number | null,
): boolean {
  if (maxMatchId === null) return false;
  return maxMatchId > (lastMatchId ?? 0);
}

/**
 * ¿Ya se publicó la edición de esa fecha?
 *
 * `NewsletterEditions` tiene un UNIQUE en `publishedOn`, así que dos ediciones
 * del mismo día son imposibles. Lo que hace falta es enterarse ANTES y no
 * después: el INSERT es lo último que pasa en `generarYPublicar`, o sea que un
 * choque contra ese UNIQUE se cobra los catorce minutos y los USD 2,50 de la
 * llamada a la API para después tirar todo. Es exactamente lo que pasó el día
 * del deploy: la inaugural salió a la mañana y el botón, apretado de nuevo a la
 * tarde, gastó una generación entera para morir en el INSERT.
 *
 * Alcanza con mirar la ÚLTIMA edición y no hace falta una consulta nueva: si
 * existe una edición de hoy, es la última —el `ORDER BY publishedOn DESC` no
 * puede devolver otra cosa, porque no se insertan fechas futuras—, y los dos
 * caminos que publican ya la tienen leída para saber contra qué diffear.
 *
 * Va exportada aparte de la clase por el mismo motivo que `hayNovedades`: es
 * lógica pura y así se testea sin levantar el contenedor de Nest.
 */
export function yaHayEdicionDe(fecha: string, anterior: LastEdition | null): boolean {
  return anterior?.publishedOn === fecha;
}

/**
 * ¿Se cargaron partidos DESPUÉS de que saliera esta edición?
 *
 * Es lo que decide contra qué foto se compara una regeneración, y es la misma
 * pregunta que el cron le hace al mundo todas las madrugadas, hecha ahora sobre
 * una edición puntual: su `lastMatchId` es exactamente hasta dónde contó.
 *
 * ## Por qué el "antes" de regenerar no puede ser siempre el mismo
 *
 * Regenerar sirve para dos cosas distintas, y quieren fotos distintas:
 *
 *   · **No me gustó cómo quedó redactada.** No pasó nada nuevo; lo que se
 *     quiere es la MISMA historia mejor contada. El "antes" tiene que seguir
 *     siendo la foto de la edición anterior, o el diario se compararía contra
 *     sí mismo y no tendría nada que reportar.
 *   · **Cargué un partido y quiero el diario al día ahora.** Ahí el "antes"
 *     correcto es la foto de la PROPIA edición: es el estado del mundo tal como
 *     estaba cuando salió, o sea justo antes del partido nuevo. Compararse
 *     contra la edición anterior volvería a contar lo que esta ya contó.
 *
 * Elegir por el puntero resuelve las dos sin pedirle al usuario que declare
 * cuál está haciendo, y además deja la operación repetible: la primera
 * regeneración adelanta `lastMatchId` hasta el partido nuevo, así que la
 * segunda vuelve sola al primer caso y reescribe en vez de salir en blanco.
 */
export function hayMaterialSinContar(
  edicion: LastEdition,
  maxMatchId: number | null,
): boolean {
  return hayNovedades(maxMatchId, edicion.lastMatchId);
}

/**
 * Lee el diario y, cuando hay material nuevo, lo escribe.
 *
 * ## Las dos lecturas y sus dos "no hay"
 *
 * Pedir la última edición de un diario que todavía no publicó nada no es un
 * error: es el estado inicial del sistema, y la respuesta es `null` para que el
 * frontend dibuje el cartel de "todavía no salió el primer número". Pedir una
 * fecha puntual que no existe sí es un 404: ahí el cliente pidió algo concreto
 * que no está.
 *
 * ## La regla que ordena el manejo de errores de la escritura
 *
 * **El puntero avanza sólo si la edición se publicó.** Si la API se cae, si el
 * modelo termina sin llamar a la herramienta, si el INSERT falla — `lastMatchId`
 * queda donde estaba y mañana el cron reintenta con el mismo material. Nunca se
 * pierde una jornada. Por eso el puntero no se guarda en ningún lado más que en
 * la propia fila de la edición, y se escribe en la misma transacción que las
 * notas: no hay forma de mover uno sin el otro.
 */
@Injectable()
export class NewsletterService {
  private readonly logger = new Logger(NewsletterService.name);

  /**
   * El candado de una generación a la vez.
   *
   * NO es prolijidad: dos ediciones concurrentes chocarían contra el UNIQUE de
   * `publishedOn` DESPUÉS de gastar USD 1,42 cada una, y la que pierda tira
   * catorce minutos de trabajo. Con el candado, el segundo click responde 409 al
   * instante y no se llama a la API.
   *
   * Una propiedad de instancia alcanza porque **el backend corre en un solo
   * proceso**. El día que haya dos réplicas, esto pasa a necesitar un lock en la
   * base — y ese día los dos UNIQUE de la tabla siguen siendo la red de
   * seguridad real, porque la segunda edición falla al insertar en vez de
   * duplicarse.
   *
   * Lo toman los tres caminos que llaman a la API, no sólo el botón: si el cron
   * está corriendo, el botón rebota, y si el botón está corriendo, el cron se
   * saltea el turno en vez de pelearse por la fecha.
   */
  private generando = false;

  constructor(
    @Inject(NEWSLETTER_REPOSITORY)
    private readonly newsletterRepository: INewsletterRepository,
    private readonly dossierBuilder: DossierBuilder,
    private readonly client: NewsletterClient,
    private readonly realtime: RealtimeService,
  ) {}

  // ─── Lectura ────────────────────────────────────────────────────────────────

  async findLatest(): Promise<EditionResponseDto | null> {
    return this.newsletterRepository.findLatest();
  }

  async findByDate(date: string): Promise<EditionResponseDto> {
    const edition = await this.newsletterRepository.findByDate(date);

    if (!edition) {
      throw new NotFoundException({
        message: 'Edition not found',
        errorCode: AppErrorCode.NEWSLETTER_EDITION_NOT_FOUND,
      });
    }

    return edition;
  }

  async findArchive(): Promise<EditionSummaryDto[]> {
    return this.newsletterRepository.findArchive();
  }

  /** La configuración del diario. El controller la cierra con `@AdminOnly()`. */
  async findConfig(): Promise<NewsletterConfigRow> {
    return this.newsletterRepository.findConfig();
  }

  // ─── Publicación ────────────────────────────────────────────────────────────

  /**
   * Lo que corre el cron. Devuelve `null` cuando no había nada que contar.
   *
   * Los tres motivos para no publicar son distintos y ninguno es un error: el
   * diario está apagado en la base, ya hay una generación en curso, o no se
   * cargó ningún partido desde la edición anterior. En los tres el puntero
   * queda donde estaba.
   */
  async publicarSiHayNovedades(): Promise<Edition | null> {
    const config = await this.newsletterRepository.findConfig();
    if (!config.isEnabled) {
      this.logger.log('MurieronNews deshabilitado en NewsletterConfig');
      return null;
    }

    // El chequeo y la toma del candado no tienen ningún `await` en el medio, y
    // eso es lo que los hace atómicos: Node corre un solo hilo, así que entre
    // las dos líneas no se puede colar otra generación.
    if (this.generando) {
      this.logger.warn('Ya hay una generación en curso: el cron se saltea el turno');
      return null;
    }
    this.generando = true;

    try {
      const maxMatchId = await this.newsletterRepository.findMaxMatchId();
      const anterior = await this.newsletterRepository.findLastEdition();

      if (!hayNovedades(maxMatchId, anterior?.lastMatchId ?? null)) {
        this.logger.log(
          `Sin partidos nuevos desde el matchId ${anterior?.lastMatchId ?? 0}: no se publica`,
        );
        return null;
      }

      return await this.generarYPublicar(config, anterior);
    } finally {
      this.generando = false;
    }
  }

  /**
   * Lo que llama el endpoint: publica una edición AHORA, haya o no partidos
   * nuevos, y vuelve enseguida.
   *
   * El guard de `hayNovedades` existe para que el cron no gaste una llamada a la
   * API todas las madrugadas sobre material ya contado. Cuando la orden viene de
   * una persona que apretó un botón, esa protección sobra: si pide una edición,
   * es porque la quiere.
   *
   * **La generación tarda entre 8 y 14 minutos** —el turno más largo medido fue
   * de 844 segundos— y eso excede el timeout de cualquier proxy razonable. Por
   * eso el endpoint responde 202 y no la edición: el frontend se entera por el
   * evento `newsletter:published` del socket. Un botón que se queda diez minutos
   * girando y termina en un 504 es peor que no tener botón.
   *
   * ## Por qué los tres rebotes pasan ANTES de encolar
   *
   * Devolver 202 es prometer que la generación arrancó. Los tres motivos por los
   * que puede no arrancar —el diario apagado, otra generación en curso, la
   * edición de hoy ya publicada— se resuelven con dos SELECT de milisegundos,
   * así que se contestan en el momento y con un 409 que el navegador ve. Lo
   * único que se manda al fondo es lo que de verdad tarda.
   *
   * Que esto sea `async` no reabre la ventana de los dos clicks: el candado se
   * toma sincrónicamente, en la línea siguiente al chequeo y antes del primer
   * `await`, así que sigue sin haber un punto en el que dos pedidos puedan
   * pasar los dos. Lo que sí hace falta es soltarlo a mano si rebotamos, porque
   * en ese camino no llega a existir ninguna promesa con `finally`.
   *
   * Una vez encolada, los errores ya no tienen a quién subir: la respuesta se
   * mandó hace rato. Van al log, que es donde se los busca.
   */
  async publicarAhoraEnSegundoPlano(): Promise<void> {
    if (this.generando) {
      throw new ConflictException({
        message: 'Ya hay una generación en curso',
        errorCode: AppErrorCode.NEWSLETTER_ALREADY_GENERATING,
      });
    }
    this.generando = true;

    try {
      const config = await this.newsletterRepository.findConfig();
      if (!config.isEnabled) {
        throw new ConflictException({
          message: 'MurieronNews está deshabilitado en NewsletterConfig',
          errorCode: AppErrorCode.NEWSLETTER_DISABLED,
        });
      }

      // La misma lectura que necesita `generarYPublicar` para saber contra qué
      // diffear sirve para saber si el día está libre, así que el chequeo que
      // evita quemar una generación no cuesta ninguna consulta extra.
      const anterior = await this.newsletterRepository.findLastEdition();
      const hoy = fechaDeHoy();
      if (yaHayEdicionDe(hoy, anterior)) {
        throw new ConflictException({
          message: `Ya existe la edición del ${hoy}. Para reescribirla, regenerala.`,
          errorCode: AppErrorCode.NEWSLETTER_EDITION_ALREADY_EXISTS,
        });
      }

      void this.generarYPublicar(config, anterior)
        .then((edicion) =>
          this.logger.log(`MurieronNews Nº ${edicion.editionNumber} publicada a mano`),
        )
        .catch((error: unknown) => {
          const mensaje = error instanceof Error ? error.message : String(error);
          this.logger.error(`La generación manual falló: ${mensaje}`);
        })
        .finally(() => {
          this.generando = false;
        });
    } catch (error) {
      this.generando = false;
      throw error;
    }
  }

  /**
   * Reescribe la edición de una fecha. Es la misma edición, no una nueva.
   *
   * Dos diferencias con publicar: el "antes" es el snapshot de la edición
   * ANTERIOR a esa fecha —no el de la última que haya— y en vez de insertar
   * reemplaza, conservando el `editionNumber`.
   *
   * Ojo con lo que se pierde: las notas editadas a mano se van con las viejas.
   *
   * ## Por qué esto también responde 202
   *
   * Regenerar cuesta los mismos 8 a 14 minutos que publicar: es la misma
   * llamada al modelo con el mismo dossier, sólo cambia contra qué se compara y
   * si al final se hace INSERT o UPDATE. Devolver la edición terminada en la
   * misma conexión pedía que el navegador, el proxy y el backend aguantaran
   * despiertos ese rato, y el eslabón que se cortaba primero era el proxy: el
   * botón terminaba siempre en un error aunque la edición se hubiera
   * reescrito bien del otro lado.
   *
   * Así que hace lo mismo que el otro: los rebotes baratos —generación en
   * curso, diario apagado, fecha inexistente— se contestan al instante con su
   * código HTTP, y lo que tarda se manda al fondo. La pantalla se entera por el
   * mismo evento `newsletter:published` de siempre.
   */
  async regenerarEnSegundoPlano(date: string): Promise<void> {
    if (this.generando) {
      throw new ConflictException({
        message: 'Ya hay una generación en curso',
        errorCode: AppErrorCode.NEWSLETTER_ALREADY_GENERATING,
      });
    }
    this.generando = true;

    try {
      const config = await this.newsletterRepository.findConfig();
      if (!config.isEnabled) {
        throw new ConflictException({
          message: 'MurieronNews está deshabilitado en NewsletterConfig',
          errorCode: AppErrorCode.NEWSLETTER_DISABLED,
        });
      }

      // Que la fecha exista se chequea ANTES de llamar a la API y no adentro de
      // `replaceEdition`: enterarse de que no existe después de gastar catorce
      // minutos y USD 2,50 sería el peor momento posible.
      //
      // `findEditionOn` y no `findByDate` porque la misma lectura sirve para las
      // dos cosas que hacen falta: confirmar que el día existe, y traer el
      // puntero y la foto con los que se decide contra qué compararse. Y es más
      // liviana: `findByDate` arrastra todas las notas con sus jugadores para
      // dibujarlas, que acá no se miran.
      const propia = await this.newsletterRepository.findEditionOn(date);
      if (!propia) {
        throw new NotFoundException({
          message: 'Edition not found',
          errorCode: AppErrorCode.NEWSLETTER_EDITION_NOT_FOUND,
        });
      }

      void this.rehacerEdicion(config, propia)
        .then((edicion) =>
          this.logger.log(`MurieronNews Nº ${edicion.editionNumber} regenerada a mano`),
        )
        .catch((error: unknown) => {
          const mensaje = error instanceof Error ? error.message : String(error);
          this.logger.error(`La regeneración de ${date} falló: ${mensaje}`);
        })
        .finally(() => {
          this.generando = false;
        });
    } catch (error) {
      this.generando = false;
      throw error;
    }
  }

  /** El trabajo caro de regenerar, ya con los rebotes baratos atrás. */
  private async rehacerEdicion(
    config: NewsletterConfigRow,
    propia: LastEdition,
  ): Promise<Edition> {
    const date = propia.publishedOn;

    // Contra qué foto se diffea. Ver `hayMaterialSinContar`: si desde que salió
    // esta edición se cargaron partidos, el "antes" correcto es su propia foto
    // —el mundo tal como estaba cuando salió, o sea justo antes de esos
    // partidos— y el diario los cuenta como la novedad que son. Si no se cargó
    // nada, se vuelve al "antes" de siempre, la edición anterior, y lo que sale
    // es la misma historia contada de nuevo.
    const maxMatchId = await this.newsletterRepository.findMaxMatchId();
    const alDia = hayMaterialSinContar(propia, maxMatchId);

    const anterior = alDia
      ? propia
      : await this.newsletterRepository.findEditionBefore(date);

    this.logger.log(
      alDia
        ? `Regenerando el ${date} CON material nuevo: se diffea contra su propia foto ` +
            `(puntero en el matchId ${propia.lastMatchId}, ahora hay ${maxMatchId ?? 0})`
        : `Regenerando el ${date} sin material nuevo: se reescribe contra la edición anterior`,
    );

    const { dossier, generacion } = await this.generar(config, anterior);

    // `publishedOn` va con la fecha PEDIDA y no con la de hoy: se está
    // reescribiendo el diario del martes, aunque hoy sea jueves. El
    // repositorio ubica la fila por el parámetro `date` y no toca la columna.
    const edition = await this.newsletterRepository.replaceEdition(
      date,
      this.datosEdicion(date, dossier, generacion),
    );

    this.realtime.emit(RealtimeEvent.NEWSLETTER_PUBLISHED, {
      publishedOn: edition.publishedOn,
    });

    this.logger.log(
      `MurieronNews Nº ${edition.editionNumber} del ${edition.publishedOn} regenerada: ` +
        `${edition.articles.length} notas`,
    );

    return edition;
  }

  // ─── Administración ─────────────────────────────────────────────────────────

  /** Corrige una nota a mano. El repositorio marca `isEdited = true`. */
  async updateArticle(articleId: number, dto: UpdateArticleDto): Promise<Article> {
    return this.newsletterRepository.updateArticle(articleId, dto);
  }

  /** Borra una nota. Sus jugadores se van con ella por ON DELETE CASCADE. */
  async deleteArticle(articleId: number): Promise<void> {
    return this.newsletterRepository.deleteArticle(articleId);
  }

  /**
   * Reemplaza la configuración entera. `groupLore`/`styleGuide` ausentes o
   * vacíos se guardan como `null`: es la forma de borrarlos.
   */
  async updateConfig(dto: UpdateConfigDto): Promise<NewsletterConfigRow> {
    return this.newsletterRepository.updateConfig({
      paperName: dto.paperName,
      groupLore: dto.groupLore ?? null,
      styleGuide: dto.styleGuide ?? null,
      isEnabled: dto.isEnabled,
    });
  }

  // ─── El tramo compartido ────────────────────────────────────────────────────

  /**
   * Genera y guarda. Es el cuerpo común del cron y del botón: lo único que los
   * distingue es el guard de novedades, que ya quedó atrás cuando se llega acá.
   *
   * El orden importa. El puntero y el snapshot se mueven DENTRO de la misma
   * transacción que las notas, y esa transacción es lo último que pasa: si el
   * INSERT falla, `lastMatchId` queda donde estaba y mañana el cron reintenta
   * con el mismo material.
   */
  private async generarYPublicar(
    config: NewsletterConfigRow,
    anterior: LastEdition | null,
  ): Promise<Edition> {
    // ANTES de `generar`, que es lo que cuesta plata. El UNIQUE de
    // `publishedOn` rebotaría igual el INSERT de más abajo, pero recién después
    // de haber pagado la generación entera. Ver `yaHayEdicionDe`.
    //
    // Está acá y no en los dos llamadores porque es el único punto por el que
    // pasan los dos caminos que insertan —el cron y el botón—, así que ninguno
    // se lo puede saltear. `regenerar` no pasa por acá a propósito: reemplaza
    // la fila de esa fecha en vez de insertar una nueva, y su UPDATE no toca el
    // UNIQUE.
    const hoy = fechaDeHoy();
    if (yaHayEdicionDe(hoy, anterior)) {
      throw new ConflictException({
        message: `Ya existe la edición del ${hoy}. Para reescribirla, regenerala.`,
        errorCode: AppErrorCode.NEWSLETTER_EDITION_ALREADY_EXISTS,
      });
    }

    const { dossier, generacion } = await this.generar(config, anterior);

    const edition = await this.newsletterRepository.insertEdition(
      this.datosEdicion(dossier.contexto.fecha, dossier, generacion),
    );

    this.realtime.emit(RealtimeEvent.NEWSLETTER_PUBLISHED, {
      publishedOn: edition.publishedOn,
    });

    this.logger.log(
      `MurieronNews Nº ${edition.editionNumber} del ${edition.publishedOn}: ` +
        `${edition.articles.length} notas, puntero en el matchId ${dossier.contexto.ultimoMatchId}`,
    );

    return edition;
  }

  /** El dossier y la llamada al modelo: los ocho a catorce minutos caros. */
  private async generar(
    config: NewsletterConfigRow,
    anterior: LastEdition | null,
  ): Promise<{ dossier: Dossier; generacion: Generacion }> {
    const titulares = await this.newsletterRepository.findRecentHeadlines();
    const dossier = await this.dossierBuilder.build(titulares);
    const playerIds = new Set(Object.keys(dossier.estado.jugadores).map(Number));

    // El plan decía `anterior === null` y no alcanza. Lo único que decide este
    // flag es entre TRABAJO y TRABAJO_INAUGURAL, y TRABAJO le ORDENA al modelo
    // diffear dos fotos: con una edición cargada a mano —o con cualquier fila
    // cuyo snapshot haya quedado en NULL— el diario saldría persiguiendo un
    // "antes" que no existe y reportando cambios fantasma. La pregunta que
    // importa no es si hubo una edición anterior, sino si hay algo con qué
    // compararse. Es el mismo criterio que usa el dry-run.
    const esInaugural = anterior?.snapshot == null;

    this.logger.log(
      esInaugural
        ? 'Edición INAUGURAL: no hay foto anterior, el prompt presenta el mundo'
        : `Diffeando contra el snapshot v${anterior?.snapshotVersion ?? 0} del ${anterior?.publishedOn ?? '?'}`,
    );

    const generacion = await this.client.generar(
      dossier,
      config,
      esInaugural,
      playerIds,
      anterior?.snapshot ?? null,
    );

    return { dossier, generacion };
  }

  /**
   * Lo que va a la fila de la edición.
   *
   * `lastMatchId` sale del dossier y no de una lectura propia: es el mismo
   * `SELECT MAX(matchId)`, pero tomado en el momento en que se armó el material
   * que el diario efectivamente cuenta. Si entre el guard y el dossier entró un
   * partido, la crónica ya lo incluye, y anotar el número viejo haría que
   * mañana se vuelva a publicar sobre lo mismo.
   *
   * `inputTokens` guarda los tres contadores de entrada sumados y no
   * `usage.input_tokens` pelado. **Ese solo miente**: excluye lo que se sirvió
   * del caché, y en la primera corrida real dio 24 sobre 1,76M de tokens
   * procesados. Guardar el 24 sería anotar que el diario sale gratis.
   */
  private datosEdicion(
    publishedOn: string,
    dossier: Dossier,
    generacion: Generacion,
  ): DatosEdicion {
    return {
      publishedOn,
      lastMatchId: dossier.contexto.ultimoMatchId,
      snapshotVersion: dossier.estado.version,
      snapshot: dossier.estado,
      model: generacion.model,
      inputTokens:
        generacion.inputTokens + generacion.cacheWriteTokens + generacion.cacheReadTokens,
      outputTokens: generacion.outputTokens,
      notas: generacion.notas,
    };
  }
}
