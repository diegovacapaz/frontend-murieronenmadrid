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
   * Publica una edición AHORA, haya o no partidos nuevos.
   *
   * El guard de `hayNovedades` existe para que el cron no gaste una llamada a la
   * API todas las madrugadas sobre material ya contado. Cuando la orden viene de
   * una persona que apretó un botón, esa protección sobra: si pide una edición,
   * es porque la quiere.
   *
   * `isEnabled` SÍ se respeta: es la llave de corte del sistema, no una
   * preferencia del cron.
   *
   * Dos diferencias con el cron, y ninguna es opcional:
   *
   *   · **Devuelve la edición, no `null`.** Quien apretó el botón está esperando
   *     el resultado.
   *   · **Los errores suben.** El cron atrapa y reintenta mañana porque no hay
   *     nadie mirando; acá hay alguien esperando y tiene que ver qué pasó.
   */
  async publicarAhora(): Promise<Edition> {
    const config = await this.newsletterRepository.findConfig();
    if (!config.isEnabled) {
      throw new ConflictException({
        message: 'MurieronNews está deshabilitado en NewsletterConfig',
        errorCode: AppErrorCode.NEWSLETTER_DISABLED,
      });
    }

    const anterior = await this.newsletterRepository.findLastEdition();
    return this.generarYPublicar(config, anterior);
  }

  /**
   * Lo que llama el endpoint: arranca la generación y vuelve enseguida.
   *
   * **La generación tarda entre 8 y 14 minutos** —el turno más largo medido fue
   * de 844 segundos— y eso excede el timeout de cualquier proxy razonable. Por
   * eso el endpoint responde 202 y no la edición: el frontend se entera por el
   * evento `newsletter:published` del socket. Un botón que se queda diez minutos
   * girando y termina en un 504 es peor que no tener botón.
   *
   * El candado se toma ACÁ y de forma sincrónica, antes de devolver: si se
   * tomara adentro de `publicarAhora`, que es `async`, dos clicks seguidos
   * pasarían los dos el chequeo antes de que el primero llegara a marcar nada.
   */
  publicarAhoraEnSegundoPlano(): void {
    if (this.generando) {
      throw new ConflictException({
        message: 'Ya hay una generación en curso',
        errorCode: AppErrorCode.NEWSLETTER_ALREADY_GENERATING,
      });
    }
    this.generando = true;

    void this.publicarAhora()
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
  }

  /**
   * Reescribe la edición de una fecha. Es la misma edición, no una nueva.
   *
   * Dos diferencias con publicar: el "antes" es el snapshot de la edición
   * ANTERIOR a esa fecha —no el de la última que haya— y en vez de insertar
   * reemplaza, conservando el `editionNumber`.
   *
   * Que exista la edición se chequea ANTES de llamar a la API y no adentro de
   * `replaceEdition`: enterarse de que la fecha no existe después de gastar
   * catorce minutos y USD 1,42 sería el peor momento posible.
   *
   * Ojo con lo que se pierde: las notas editadas a mano se van con las viejas.
   */
  async regenerar(date: string): Promise<Edition> {
    const config = await this.newsletterRepository.findConfig();
    if (!config.isEnabled) {
      throw new ConflictException({
        message: 'MurieronNews está deshabilitado en NewsletterConfig',
        errorCode: AppErrorCode.NEWSLETTER_DISABLED,
      });
    }

    const existente = await this.newsletterRepository.findByDate(date);
    if (!existente) {
      throw new NotFoundException({
        message: 'Edition not found',
        errorCode: AppErrorCode.NEWSLETTER_EDITION_NOT_FOUND,
      });
    }

    if (this.generando) {
      throw new ConflictException({
        message: 'Ya hay una generación en curso',
        errorCode: AppErrorCode.NEWSLETTER_ALREADY_GENERATING,
      });
    }
    this.generando = true;

    try {
      const anterior = await this.newsletterRepository.findEditionBefore(date);
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
    } finally {
      this.generando = false;
    }
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
