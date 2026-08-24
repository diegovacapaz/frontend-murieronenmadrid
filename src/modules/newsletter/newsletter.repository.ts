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
      // El ORDER BY va calificado con el alias de la tabla a propósito: sin el
      // `e.`, MySQL lo resuelve al alias del SELECT —el string del DATE_FORMAT—
      // y no a la columna DATE. Acá ordena igual porque las fechas ISO ordenan
      // como texto, pero el día que el formato cambie no queremos descubrirlo
      // por un archivo desordenado.
      const [editions] = await conn.execute<EditionDB[] & RowDataPacket[]>(
        `SELECT e.editionNumber, DATE_FORMAT(e.publishedOn, '%Y-%m-%d') AS publishedOn,
                e.publishedAt, e.editionId
           FROM NewsletterEditions e
          ORDER BY e.publishedOn DESC
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
        `SELECT e.editionNumber, DATE_FORMAT(e.publishedOn, '%Y-%m-%d') AS publishedOn,
                e.publishedAt, e.editionId
           FROM NewsletterEditions e
          WHERE e.publishedOn = ?`,
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
      //
      // El GROUP BY es lo que garantiza UNA fila por edición. Sin él, el join
      // devuelve una fila por nota de portada, y hoy nada impide que haya dos:
      // el CHECK de la tabla restringe la letra de `section`, no la cantidad de
      // notas con esa letra, y el unique sobre (editionId, section) todavía no
      // existe. Quien escribe las notas es un modelo de lenguaje, así que "no
      // debería pasar" no alcanza como garantía: una edición duplicada en el
      // archivo sería un bug visible en la pantalla.
      //
      // Con dos portadas, MAX() elige una sola —la de titular mayor
      // alfabéticamente— y siempre la misma. Arbitraria, pero estable: la
      // pantalla no parpadea entre dos titulares según el plan del optimizador.
      const [rows] = await conn.execute<EditionSummaryDB[] & RowDataPacket[]>(
        `SELECT e.editionNumber,
                DATE_FORMAT(e.publishedOn, '%Y-%m-%d') AS publishedOn,
                MAX(CASE WHEN a.section = 'P' THEN a.headline END) AS headline
           FROM NewsletterEditions e
           LEFT JOIN NewsletterArticles a ON a.editionId = e.editionId
          GROUP BY e.editionId, e.editionNumber, e.publishedOn
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
    //
    // El ORDER BY no es decorativo: el rol de un jugador decide qué foto
    // ilustra la nota, así que un frontend que agarre `players[0]` está
    // leyendo un orden. Sin la cláusula ese orden es el de la PK por
    // accidente, y el accidente puede cambiar con el plan del optimizador.
    const [players] = await conn.execute<ArticlePlayerDB[] & RowDataPacket[]>(
      `SELECT ap.articleId, ap.playerId, ap.role, p.displayName, p.photo
         FROM NewsletterArticlePlayers ap
         INNER JOIN vPlayerDetail p ON p.playerId = ap.playerId
        WHERE ap.articleId IN (
                SELECT articleId FROM NewsletterArticles WHERE editionId = ?
              )
        ORDER BY ap.articleId, ap.playerId`,
      [edition.editionId],
    );

    return NewsletterFactory.toEdition(edition, articles, players);
  }
}
