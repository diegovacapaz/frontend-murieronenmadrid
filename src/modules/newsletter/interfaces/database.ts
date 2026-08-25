import type { Row } from '../../../database/database.types';

/**
 * Las filas crudas tal como vuelven de mysql2, con los tipos que entrega el
 * driver y no los que quisiéramos: traducirlos es trabajo del factory.
 *
 * "Como vuelven de mysql2" acá quiere decir: como vuelven del pool de este
 * sistema, que tiene un `typeCast` propio (ver database.pool-factory.ts). Por
 * eso los `DATETIME` llegan como `Date` en UTC, los `JSON` ya parseados y los
 * `BOOLEAN` como boolean de verdad y no como 0/1.
 */

export interface EditionDB extends Row {
  editionId: number;
  editionNumber: number;
  publishedOn: string; // ya formateada con DATE_FORMAT; ver la nota de LastEditionDB
  publishedAt: Date;
}

export interface ArticleDB extends Row {
  articleId: number;
  section: string; // el CHAR(1) crudo; el factory lo pasa a ArticleSection
  headline: string;
  standfirst: string;
  body: string;
  sortOrder: number;
  isEdited: boolean; // TINYINT(1), que el typeCast del pool ya convierte
}

export interface ArticlePlayerDB extends Row {
  articleId: number;
  playerId: number;
  role: string; // el CHAR(1) crudo; el factory lo pasa a PlayerRole
  displayName: string;
  photo: string | null;
}

export interface EditionSummaryDB extends Row {
  editionNumber: number;
  publishedOn: string;
  headline: string | null; // null si la edición quedó sin portada
}

/** La fila de NewsletterEditions que necesita el flujo de generación. */
export interface LastEditionDB extends Row {
  editionId: number;
  editionNumber: number;
  /**
   * SOLO es `string` si la consulta la trae con `DATE_FORMAT(publishedOn,
   * '%Y-%m-%d')`. El `typeCast` del pool no toca `DATE`, así que un
   * `SELECT publishedOn` natural devuelve un `Date` mientras TypeScript sigue
   * diciendo `string` — y `last.publishedOn === hoy` da false para siempre, en
   * silencio. Es el mismo bug mudo que `isEnabled`, en la otra dirección.
   *
   * Ninguna consulta de este módulo produce esta fila todavía: la escribe la
   * tarea de persistencia, y el tipo es una promesa que esa consulta tiene que
   * cumplir.
   */
  publishedOn: string;
  lastMatchId: number;
  snapshotVersion: number;
  snapshot: unknown; // columna JSON: mysql2 la parsea sola, y puede ser null
}

export interface ConfigDB extends Row {
  paperName: string;
  groupLore: string | null;
  styleGuide: string | null;
  isEnabled: boolean;
}
