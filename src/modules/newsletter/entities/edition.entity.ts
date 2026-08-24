import { ArticleSection, PlayerRole } from '../enums/newsletter.enums';

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
