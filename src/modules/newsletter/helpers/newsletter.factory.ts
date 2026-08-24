import {
  Article,
  ArticlePlayer,
  Edition,
  EditionSummary,
  LastEdition,
} from '../entities/edition.entity';
import { ArticleSection, PlayerRole } from '../enums/newsletter.enums';
import {
  ArticleDB,
  ArticlePlayerDB,
  EditionDB,
  EditionSummaryDB,
  LastEditionDB,
} from '../interfaces/database';
import type { DossierEstado } from '../interfaces/dossier';

/**
 * Arma las entidades del diario desde las filas de la base.
 *
 * Lo único que hace además de copiar campos es agrupar: el repositorio trae las
 * notas en una consulta y los jugadores de TODAS esas notas en otra, y acá se
 * unen en memoria. Es a propósito: si el armado viviera en el repositorio,
 * lo natural sería pedir los jugadores nota por nota y una edición de ocho
 * secciones costaría nueve consultas en vez de tres.
 */
export class NewsletterFactory {
  static toEdition(
    edition: EditionDB,
    articles: ArticleDB[],
    players: ArticlePlayerDB[],
  ): Edition {
    const byArticle = NewsletterFactory.groupPlayers(players);

    return {
      editionNumber: edition.editionNumber,
      publishedOn: edition.publishedOn,
      // La columna es DATETIME y el pool la entrega como Date en UTC. Sale como
      // string con sufijo Z, que es la convención de fechas de toda la API.
      publishedAt: edition.publishedAt.toISOString(),
      articles: articles.map((article) =>
        NewsletterFactory.toArticle(article, byArticle.get(article.articleId) ?? []),
      ),
    };
  }

  static toArticle(db: ArticleDB, players: ArticlePlayer[]): Article {
    return {
      articleId: db.articleId,
      section: db.section as ArticleSection,
      headline: db.headline,
      standfirst: db.standfirst,
      body: db.body,
      sortOrder: db.sortOrder,
      isEdited: db.isEdited,
      players,
    };
  }

  static toArticlePlayer(db: ArticlePlayerDB): ArticlePlayer {
    return {
      playerId: db.playerId,
      displayName: db.displayName,
      photo: db.photo,
      role: db.role as PlayerRole,
    };
  }

  /**
   * La edición anterior vista por el flujo de generación: puntero y foto.
   *
   * El único trabajo real es el `snapshot`. La columna es JSON y el typeCast
   * del pool la entrega YA PARSEADA, así que acá no se hace `JSON.parse` —
   * hacerlo tiraría un "[object Object] is not valid JSON" el día que el diario
   * publique por segunda vez, que es el peor momento para enterarse.
   *
   * Y se castea en vez de validarse: `DossierEstado` es en su mayoría `unknown`
   * a propósito (son las respuestas de los SP sin tocar), así que no hay una
   * forma que chequear. Lo que sí se chequea, y vale más, es el
   * `snapshotVersion`: si no coincide con el de hoy, el prompt le avisa al
   * modelo que las dos fotos no son comparables campo a campo.
   */
  static toLastEdition(db: LastEditionDB): LastEdition {
    return {
      editionId: db.editionId,
      editionNumber: db.editionNumber,
      publishedOn: db.publishedOn,
      lastMatchId: db.lastMatchId,
      snapshotVersion: db.snapshotVersion,
      snapshot: (db.snapshot as DossierEstado | null) ?? null,
    };
  }

  static toEditionSummary(db: EditionSummaryDB): EditionSummary {
    return {
      editionNumber: db.editionNumber,
      publishedOn: db.publishedOn,
      // El LEFT JOIN admite una edición sin portada, que no debería existir. Si
      // pasara, el archivo la lista igual con el titular vacío: perder la fila
      // sería esconder que esa edición salió.
      headline: db.headline ?? '',
    };
  }

  static toArchive(dbs: EditionSummaryDB[]): EditionSummary[] {
    return dbs.map((db) => NewsletterFactory.toEditionSummary(db));
  }

  /** Los jugadores de la consulta única, repartidos por nota. */
  private static groupPlayers(dbs: ArticlePlayerDB[]): Map<number, ArticlePlayer[]> {
    const byArticle = new Map<number, ArticlePlayer[]>();

    for (const db of dbs) {
      const players = byArticle.get(db.articleId);
      const player = NewsletterFactory.toArticlePlayer(db);

      if (players) {
        players.push(player);
      } else {
        byArticle.set(db.articleId, [player]);
      }
    }

    return byArticle;
  }
}
