import type {
  Edition,
  EditionSummary,
  LastEdition,
  NewsletterConfigRow,
} from '../entities/edition.entity';

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
}
