import type { Edition, EditionSummary } from '../entities/edition.entity';

export interface INewsletterRepository {
  /** La edición más reciente, o null si el diario todavía no publicó nada. */
  findLatest(): Promise<Edition | null>;

  /** Una edición por su fecha de publicación (YYYY-MM-DD), o null si no hubo. */
  findByDate(date: string): Promise<Edition | null>;

  /** El archivo completo: una fila por edición, de la más nueva a la más vieja. */
  findArchive(): Promise<EditionSummary[]>;
}
