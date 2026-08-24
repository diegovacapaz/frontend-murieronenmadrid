import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import type { PoolConnection, RowDataPacket } from '../../database/database.types';
import { Edition, EditionSummary } from './entities/edition.entity';
import { NewsletterFactory } from './helpers/newsletter.factory';
import {
  ArticleDB,
  ArticlePlayerDB,
  EditionDB,
  EditionSummaryDB,
} from './interfaces/database';
import { INewsletterRepository } from './interfaces/newsletter.repository.interface';

/**
 * El único repositorio del sistema que arma su SQL acá adentro en vez de llamar
 * a un stored procedure.
 *
 * El motivo: estas tres consultas no tienen ninguna regla de dominio. No hay
 * puntajes, ni desempates, ni rachas; son SELECT sobre tablas propias del
 * módulo. Un procedure por cada una sería ceremonia sin nada que encapsular.
 * `withConnection` es API pública del DatabaseService y los errores siguen
 * pasando por `handleDatabaseError`, así que el mapeo a excepciones de Nest es
 * el mismo que para cualquier SP.
 *
 * La excepción está acotada a la lectura del archivo: el día que aparezca una
 * regla de verdad, va a la base como todo lo demás.
 */
@Injectable()
export class NewsletterRepository implements INewsletterRepository {
  constructor(private readonly db: DatabaseService) {}

  async findLatest(): Promise<Edition | null> {
    return this.db.withConnection(async (conn) => {
      const [editions] = await conn.execute<EditionDB[] & RowDataPacket[]>(
        `SELECT editionNumber, DATE_FORMAT(publishedOn, '%Y-%m-%d') AS publishedOn,
                publishedAt, editionId
           FROM NewsletterEditions
          ORDER BY publishedOn DESC
          LIMIT 1`,
      );

      const edition = editions[0];
      if (!edition) return null;

      return this.loadEdition(conn, edition);
    });
  }

  async findByDate(date: string): Promise<Edition | null> {
    return this.db.withConnection(async (conn) => {
      const [editions] = await conn.execute<EditionDB[] & RowDataPacket[]>(
        `SELECT editionNumber, DATE_FORMAT(publishedOn, '%Y-%m-%d') AS publishedOn,
                publishedAt, editionId
           FROM NewsletterEditions
          WHERE publishedOn = ?`,
        [date],
      );

      const edition = editions[0];
      if (!edition) return null;

      return this.loadEdition(conn, edition);
    });
  }

  async findArchive(): Promise<EditionSummary[]> {
    return this.db.withConnection(async (conn) => {
      // LEFT JOIN y no INNER: una edición sin portada tiene que seguir
      // apareciendo en el archivo, aunque el titular venga vacío.
      const [rows] = await conn.execute<EditionSummaryDB[] & RowDataPacket[]>(
        `SELECT e.editionNumber,
                DATE_FORMAT(e.publishedOn, '%Y-%m-%d') AS publishedOn,
                a.headline
           FROM NewsletterEditions e
           LEFT JOIN NewsletterArticles a
             ON a.editionId = e.editionId AND a.section = 'P'
          ORDER BY e.publishedOn DESC`,
      );

      return NewsletterFactory.toArchive(rows);
    });
  }

  /**
   * Las notas de la edición y sus jugadores: dos consultas fijas, no una por
   * nota. El factory las une en memoria.
   */
  private async loadEdition(conn: PoolConnection, edition: EditionDB): Promise<Edition> {
    const [articles] = await conn.execute<ArticleDB[] & RowDataPacket[]>(
      `SELECT articleId, section, headline, standfirst, body, sortOrder, isEdited
         FROM NewsletterArticles
        WHERE editionId = ?
        ORDER BY sortOrder, articleId`,
      [edition.editionId],
    );

    // Los jugadores de TODAS las notas en una sola consulta. El JOIN a
    // vPlayerDetail es lo que trae displayName ya resuelto: la regla de
    // "apodo si tiene, nombre completo si no" vive ahí y en ningún otro lado.
    const [players] = await conn.execute<ArticlePlayerDB[] & RowDataPacket[]>(
      `SELECT ap.articleId, ap.playerId, ap.role, p.displayName, p.photo
         FROM NewsletterArticlePlayers ap
         INNER JOIN vPlayerDetail p ON p.playerId = ap.playerId
        WHERE ap.articleId IN (
                SELECT articleId FROM NewsletterArticles WHERE editionId = ?
              )`,
      [edition.editionId],
    );

    return NewsletterFactory.toEdition(edition, articles, players);
  }
}
