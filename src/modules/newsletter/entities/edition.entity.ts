import { ArticleSection, PlayerRole } from '../enums/newsletter.enums';
import type { DossierEstado } from '../interfaces/dossier';

/** Un jugador nombrado en una nota, con su foto ya resuelta. */
export interface ArticlePlayer {
  playerId: number;
  displayName: string;
  photo: string | null;
  role: PlayerRole;
}

export interface Article {
  articleId: number;
  section: ArticleSection;
  headline: string;
  standfirst: string;
  body: string;
  sortOrder: number;
  isEdited: boolean;
  players: ArticlePlayer[];
}

export interface Edition {
  editionNumber: number;
  publishedOn: string;
  publishedAt: string;
  articles: Article[];
}

/** Una fila del archivo: lo mínimo para listar sin traer los cuerpos. */
export interface EditionSummary {
  editionNumber: number;
  publishedOn: string;
  headline: string;
}

/**
 * Lo que el flujo de generación necesita saber de la edición anterior.
 *
 * No es `Edition`: ahí viven las notas, que es lo que se dibuja en pantalla.
 * Acá viven el puntero y la foto, que es lo que se lee para decidir si hay
 * material nuevo y contra qué compararlo. Dos lecturas distintas de la misma
 * tabla porque son dos preguntas distintas.
 */
export interface LastEdition {
  editionId: number;
  editionNumber: number;
  publishedOn: string;
  lastMatchId: number;
  snapshotVersion: number;
  /**
   * El estado que dejó. Es el "antes" de la edición siguiente.
   *
   * Puede ser null y no es una anomalía: la columna es NULLABLE y una edición
   * cargada a mano —o la inaugural, si alguna vez se guardara sin foto— no
   * tiene nada que ofrecer para diffear.
   */
  snapshot: DossierEstado | null;
}

/**
 * La fila única de NewsletterConfig, tal como la consume el prompt.
 *
 * `isEnabled` viaja aunque el prompt no lo use: el corte de abajo de los dos
 * —el de la base, no el de la .env— lo lee el cron desde esta misma lectura.
 */
export interface NewsletterConfigRow {
  paperName: string;
  groupLore: string | null;
  styleGuide: string | null;
  isEnabled: boolean;
}
