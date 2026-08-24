import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import type { PoolConnection, RowDataPacket } from '../../database/database.types';
import {
  Edition,
  EditionSummary,
  LastEdition,
  NewsletterConfigRow,
} from './entities/edition.entity';
import { NewsletterFactory } from './helpers/newsletter.factory';
import {
  ArticleDB,
  ArticlePlayerDB,
  ConfigDB,
  EditionDB,
  EditionSummaryDB,
  LastEditionDB,
} from './interfaces/database';
import { INewsletterRepository } from './interfaces/newsletter.repository.interface';
import { RECENT_HEADLINES } from './newsletter.constants';

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

  // ─── Las tres lecturas del flujo de generación ──────────────────────────────
  //
  // No las usa ningún endpoint: las usan el dry-run y el cron. Viven acá igual
  // porque leen las tablas del módulo y el repositorio es el único lugar del
  // sistema que toca la base.

  /**
   * La última edición publicada, con su puntero y su foto.
   *
   * El `DATE_FORMAT` NO es cosmético y no se puede sacar: `publishedOn` es
   * DATE, el typeCast del pool no toca ese tipo y devolvería un `Date` mientras
   * `LastEditionDB` sigue prometiendo `string`. Cualquier comparación contra la
   * fecha de hoy daría false para siempre, en silencio, y el cron publicaría dos
   * veces el mismo día — o ninguna. Está anotado en `interfaces/database.ts`
   * como una promesa que la consulta tiene que cumplir; esta es la consulta.
   *
   * Ordena por `publishedOn` y no por `editionNumber` por la misma razón que
   * `findLatest`: la fecha es lo que el lector entiende por "la última".
   */
  async findLastEdition(): Promise<LastEdition | null> {
    return this.db.withConnection(async (conn) => {
      const [filas] = await conn.execute<LastEditionDB[] & RowDataPacket[]>(
        `SELECT e.editionId, e.editionNumber,
                DATE_FORMAT(e.publishedOn, '%Y-%m-%d') AS publishedOn,
                e.lastMatchId, e.snapshotVersion, e.snapshot
           FROM NewsletterEditions e
          ORDER BY e.publishedOn DESC
          LIMIT 1`,
      );

      const fila = filas[0];
      return fila ? NewsletterFactory.toLastEdition(fila) : null;
    });
  }

  /**
   * La fila única de configuración.
   *
   * No hay rama de "no existe": el DDL la siembra con INSERT IGNORE y el CHECK
   * de `configId = 1` impide que haya otra. Si falta, la base está mal cargada
   * y es mejor que se note ahora que a las cinco de la mañana.
   *
   * Sin conversión de `isEnabled`: el typeCast del pool ya entregó un boolean.
   * Convertirlo acá con `Boolean(...)` sería inofensivo hoy y una mentira el día
   * que alguien cambie el typeCast, porque `Boolean('0')` es true.
   */
  async findConfig(): Promise<NewsletterConfigRow> {
    return this.db.withConnection(async (conn) => {
      const [filas] = await conn.execute<ConfigDB[] & RowDataPacket[]>(
        `SELECT paperName, groupLore, styleGuide, isEnabled
           FROM NewsletterConfig
          WHERE configId = 1`,
      );

      const fila = filas[0];
      if (!fila) {
        throw new InternalServerErrorException('Falta la fila de NewsletterConfig');
      }

      return fila;
    });
  }

  /**
   * Los titulares de portada recientes, para que el diario no se repita.
   *
   * El INNER JOIN es correcto acá, al revés que en `findArchive`: una edición
   * sin portada no aporta titular que evitar, así que no tiene sentido traerla
   * con el campo vacío. Y el LIMIT cuenta TITULARES, no ediciones: con la regla
   * de una portada por edición son lo mismo, y si alguna vez hubiera dos, traer
   * las dos es mejor que ocultar una.
   *
   * El LIMIT va INTERPOLADO y no como placeholder, y no es una distracción: con
   * `LIMIT ?` esta consulta se cae. `execute()` usa prepared statements del
   * servidor y MySQL rechaza un parámetro en la cláusula LIMIT con
   * `ER_WRONG_ARGUMENTS: Incorrect arguments to mysqld_stmt_execute`, que el
   * error-map no reconoce y traduce a un 500 sin pista de dónde salió. Se
   * verificó contra la base real, no es teoría.
   *
   * Interpolar es seguro acá y en ningún otro lado: `RECENT_HEADLINES` es una
   * constante entera del módulo, no llega de un request y no la elige nadie en
   * tiempo de ejecución. El `Number` explícito deja escrito que lo que entra al
   * SQL es un número, para que el día que alguien lo cambie por algo que viene
   * de afuera el compilador y el lector tengan dónde agarrarse.
   */
  async findRecentHeadlines(): Promise<string[]> {
    const limite = Number(RECENT_HEADLINES);

    return this.db.withConnection(async (conn) => {
      const [filas] = await conn.execute<{ headline: string }[] & RowDataPacket[]>(
        `SELECT a.headline
           FROM NewsletterArticles a
           INNER JOIN NewsletterEditions e ON e.editionId = a.editionId
          WHERE a.section = 'P'
          ORDER BY e.publishedOn DESC
          LIMIT ${limite}`,
      );

      return filas.map((fila) => fila.headline);
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
