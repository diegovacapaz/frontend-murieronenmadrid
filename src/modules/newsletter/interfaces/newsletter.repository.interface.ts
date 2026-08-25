import type {
  Article,
  Edition,
  EditionSummary,
  LastEdition,
  NewsletterConfigRow,
} from '../entities/edition.entity';
import type { DossierEstado } from './dossier';
import type { NotaValidada } from './validacion';

/**
 * Los campos que un admin puede corregir a mano en una nota ya publicada.
 *
 * Los tres opcionales porque `PATCH /articles/:id` acepta un subconjunto: el
 * repositorio arma un UPDATE solo con lo que vino.
 */
export interface UpdateArticleData {
  headline?: string;
  standfirst?: string;
  body?: string;
}

/**
 * Todo lo que hace falta para guardar una edición, en un solo objeto.
 *
 * Van juntos porque se escriben juntos o no se escribe ninguno: el puntero, el
 * snapshot y las notas son las tres patas de la misma transacción. Pasarlos
 * sueltos invitaría a que algún día alguien mueva el puntero sin guardar las
 * notas, que es exactamente el bug que la regla del módulo prohíbe —el puntero
 * avanza SÓLO si la edición se publicó—.
 */
export interface DatosEdicion {
  /** La fecha de la edición, YYYY-MM-DD. Es UNIQUE: una edición por día. */
  publishedOn: string;
  /** El `MAX(matchId)` que este diario ya contó. El "alto agua" del cron. */
  lastMatchId: number;
  snapshotVersion: number;
  /** La foto que deja. Mañana es el "antes" contra el que se diffea. */
  snapshot: DossierEstado;
  model: string;
  /**
   * Los tokens de entrada REALES, con el caché sumado.
   *
   * No es `usage.input_tokens` pelado: ese excluye lo que se sirvió del caché y
   * en la primera corrida real dio 24 sobre 1,76M procesados. Guardar ese
   * número sería anotar que el diario sale gratis.
   */
  inputTokens: number;
  outputTokens: number;
  notas: NotaValidada[];
}

export interface INewsletterRepository {
  /** La edición más reciente, o null si el diario todavía no publicó nada. */
  findLatest(): Promise<Edition | null>;

  /** Una edición por su fecha de publicación (YYYY-MM-DD), o null si no hubo. */
  findByDate(date: string): Promise<Edition | null>;

  /** El archivo completo: una fila por edición, de la más nueva a la más vieja. */
  findArchive(): Promise<EditionSummary[]>;

  /** La última edición publicada, con su puntero y su snapshot. null si no hay ninguna. */
  findLastEdition(): Promise<LastEdition | null>;

  /** La fila única de NewsletterConfig. Siempre existe: la siembra el DDL. */
  findConfig(): Promise<NewsletterConfigRow>;

  /** Los titulares de portada de las últimas RECENT_HEADLINES ediciones, más nuevo primero. */
  findRecentHeadlines(): Promise<string[]>;

  /**
   * La edición publicada inmediatamente ANTES de `date`, o null si no hubo.
   *
   * Existe por `regenerar`: reescribir la edición del martes cuando no pasó
   * nada nuevo tiene que diffear contra la foto del lunes, no contra la última
   * que haya. Usar `findLastEdition()` ahí compararía la edición contra sí
   * misma —o contra una posterior— y el diario reportaría cambios que ya había
   * contado, o ninguno.
   */
  findEditionBefore(date: string): Promise<LastEdition | null>;

  /**
   * La edición publicada EN `date`, o null si ese día no salió ninguna.
   *
   * Trae el puntero y la foto, no las notas: es la lectura que le pregunta a
   * una edición "¿hasta dónde contaste, y cómo estaba el mundo cuando lo
   * contaste?". La usa `regenerar` para dos cosas de una: chequear que la
   * fecha exista, y quedarse con la foto contra la que va a diffear si desde
   * entonces se cargaron partidos.
   */
  findEditionOn(date: string): Promise<LastEdition | null>;

  /**
   * `MAX(matchId)` de la tabla de partidos, o null si no hay ninguno.
   *
   * Es el lado izquierdo del guard del cron. Una comparación de enteros contra
   * esto es lo único que se paga cuando no hay novedades.
   */
  findMaxMatchId(): Promise<number | null>;

  /**
   * Guarda una edición nueva: la fila, sus notas y sus jugadores, atómicos.
   *
   * El `editionNumber` no viaja en `datos` porque no lo elige quien llama: sale
   * de `COALESCE(MAX(editionNumber), 0) + 1` adentro de la misma transacción.
   */
  insertEdition(datos: DatosEdicion): Promise<Edition>;

  /**
   * Reescribe la edición de esa fecha conservando su `editionNumber`.
   *
   * Es la misma edición, no una nueva: cambian las notas, el snapshot, el
   * puntero y los tokens. Si no hay edición ese día, 404.
   */
  replaceEdition(date: string, datos: DatosEdicion): Promise<Edition>;

  // ─── Administración ────────────────────────────────────────────────────────

  /**
   * Corrige una nota a mano y la marca `isEdited = true`.
   *
   * Sólo se actualizan los campos presentes en `cambios`: un PATCH con un solo
   * campo no toca los otros dos. 404 si el `articleId` no existe.
   */
  updateArticle(articleId: number, cambios: UpdateArticleData): Promise<Article>;

  /** Borra una nota. Sus jugadores se van con ella por ON DELETE CASCADE. 404 si no existe. */
  deleteArticle(articleId: number): Promise<void>;

  /** Reemplaza la fila única de NewsletterConfig entera. Es un PUT, no un PATCH. */
  updateConfig(datos: NewsletterConfigRow): Promise<NewsletterConfigRow>;
}
