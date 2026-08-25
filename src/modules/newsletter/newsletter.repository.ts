import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { AppErrorCode } from '../../common/constants/error-codes.constants';
import { DatabaseService } from '../../database/database.service';
import type {
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from '../../database/database.types';
import {
  Article,
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
import {
  DatosEdicion,
  INewsletterRepository,
  UpdateArticleData,
} from './interfaces/newsletter.repository.interface';
import type { NotaValidada } from './interfaces/validacion';
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
    return this.db.withConnection((conn) => this.leerEdicionAnterior(conn, null));
  }

  /**
   * La edición inmediatamente anterior a una fecha. La usa `regenerar`.
   *
   * Es la MISMA consulta que `findLastEdition` con un WHERE de más, y por eso
   * comparten cuerpo: son la misma pregunta —"¿contra qué foto me comparo?"—
   * hecha desde dos puntos distintos de la línea de tiempo. Dos copias del SQL
   * serían dos lugares donde acordarse del `DATE_FORMAT`.
   *
   * El `<` es estricto a propósito: la edición de esa misma fecha es la que se
   * está reescribiendo, así que compararse contra ella sería compararse contra
   * uno mismo y no reportar ningún cambio.
   */
  async findEditionBefore(date: string): Promise<LastEdition | null> {
    return this.db.withConnection((conn) => this.leerEdicionAnterior(conn, date));
  }

  /**
   * `MAX(matchId)`, o null si todavía no se cargó ningún partido.
   *
   * Un agregado sobre una tabla vacía devuelve UNA fila con NULL adentro, no
   * cero filas: por eso se lee el valor de `filas[0]` y no el largo del arreglo.
   */
  async findMaxMatchId(): Promise<number | null> {
    return this.db.withConnection(async (conn) => {
      const [filas] = await conn.execute<
        { maxMatchId: number | null }[] & RowDataPacket[]
      >(`SELECT MAX(matchId) AS maxMatchId FROM Matches`);

      return filas[0]?.maxMatchId ?? null;
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

  // ─── Las dos escrituras ─────────────────────────────────────────────────────
  //
  // Las únicas del módulo, y las dos van por `withTransaction` y no por
  // `withConnection`. No es preferencia: guardar una edición son tres INSERT
  // que valen como uno solo. Una edición sin notas, o un `editionNumber`
  // quemado por una fila que no llegó a existir, es basura que después hay que
  // limpiar a mano en la base de producción.

  /**
   * Guarda una edición nueva. Tres INSERT, una transacción.
   *
   * El `editionNumber` se calcula ACÁ ADENTRO y no lo elige quien llama: es
   * `COALESCE(MAX(editionNumber), 0) + 1`, así que la primera edición del
   * sistema es la Nº 1 sin que nadie tenga que sembrar nada. Ese SELECT es una
   * lectura consistente y no bloquea, o sea que dos transacciones simultáneas
   * podrían sacar el mismo número — de eso se ocupan el candado del service y,
   * abajo de todo, los dos UNIQUE de la tabla: la segunda falla al insertar en
   * vez de duplicar la edición.
   *
   * La edición se relee al final CON LA MISMA conexión, todavía adentro de la
   * transacción: es la forma de devolver la entidad completa —notas con sus
   * jugadores, `displayName` y foto ya resueltos por vPlayerDetail— sin armarla
   * a mano y sin arriesgar que otro escriba en el medio.
   */
  async insertEdition(datos: DatosEdicion): Promise<Edition> {
    return this.db.withTransaction(async (conn) => {
      const [filas] = await conn.execute<{ proximo: number }[] & RowDataPacket[]>(
        `SELECT COALESCE(MAX(editionNumber), 0) + 1 AS proximo FROM NewsletterEditions`,
      );
      const editionNumber = filas[0]?.proximo ?? 1;

      const [resultado] = await conn.execute<ResultSetHeader>(
        `INSERT INTO NewsletterEditions
                (editionNumber, publishedOn, lastMatchId, snapshotVersion, snapshot,
                 model, inputTokens, outputTokens)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          editionNumber,
          datos.publishedOn,
          datos.lastMatchId,
          datos.snapshotVersion,
          // La columna es JSON y el driver no serializa objetos solo: sin el
          // stringify entra el literal "[object Object]" y MySQL lo rechaza.
          JSON.stringify(datos.snapshot),
          datos.model,
          datos.inputTokens,
          datos.outputTokens,
        ],
      );

      const editionId = resultado.insertId;
      await this.insertarNotas(conn, editionId, datos.notas);

      return this.leerEdicion(conn, editionId);
    });
  }

  /**
   * Reescribe la edición de esa fecha. Es la misma edición, no una nueva.
   *
   * `editionNumber` y `publishedOn` NO se tocan: el diario Nº 7 sigue siendo el
   * Nº 7 aunque se le cambien todas las notas. Lo que se reemplaza es el
   * contenido —notas y jugadores— y lo que se actualiza es de qué material
   * salió: puntero, snapshot, modelo y tokens.
   *
   * El borrado de las notas es un DELETE sobre `NewsletterArticles` y alcanza:
   * `NewsletterArticlePlayers` cuelga con ON DELETE CASCADE, así que los
   * jugadores se van con sus notas. Borrar las dos tablas a mano sería repetir
   * una regla que ya vive en el DDL.
   *
   * El `FOR UPDATE` bloquea la fila mientras se la reescribe: sin él, dos
   * regeneraciones de la misma fecha podrían borrar cada una las notas de la
   * otra y dejar la edición con las de ninguna.
   */
  async replaceEdition(date: string, datos: DatosEdicion): Promise<Edition> {
    return this.db.withTransaction(async (conn) => {
      const [filas] = await conn.execute<{ editionId: number }[] & RowDataPacket[]>(
        `SELECT editionId FROM NewsletterEditions WHERE publishedOn = ? FOR UPDATE`,
        [date],
      );

      const fila = filas[0];
      if (!fila) {
        throw new NotFoundException({
          message: 'Edition not found',
          errorCode: AppErrorCode.NEWSLETTER_EDITION_NOT_FOUND,
        });
      }

      const { editionId } = fila;

      await conn.execute(
        `UPDATE NewsletterEditions
            SET lastMatchId = ?, snapshotVersion = ?, snapshot = ?,
                model = ?, inputTokens = ?, outputTokens = ?
          WHERE editionId = ?`,
        [
          datos.lastMatchId,
          datos.snapshotVersion,
          JSON.stringify(datos.snapshot),
          datos.model,
          datos.inputTokens,
          datos.outputTokens,
          editionId,
        ],
      );

      await conn.execute(`DELETE FROM NewsletterArticles WHERE editionId = ?`, [
        editionId,
      ]);
      await this.insertarNotas(conn, editionId, datos.notas);

      return this.leerEdicion(conn, editionId);
    });
  }

  // ─── Administración ─────────────────────────────────────────────────────────
  //
  // Las tres son escrituras de una persona, no del flujo de generación: no hay
  // ~60 llamadas a procedures atrás, así que ninguna necesita `withTransaction`
  // para más que su propio UPDATE/DELETE.

  /**
   * Corrige una nota a mano. Sólo entran al UPDATE los campos que vinieron en
   * `cambios`; `isEdited` se pone en `true` siempre, aunque el cambio sea
   * idéntico al texto que ya tenía.
   *
   * El `SET` se arma dinámico porque un PATCH con un solo campo no tiene que
   * pisar los otros dos con su propio valor releído — sería una escritura de
   * más, y en el camino habría que traer la fila antes de poder armar el
   * UPDATE completo.
   */
  async updateArticle(articleId: number, cambios: UpdateArticleData): Promise<Article> {
    return this.db.withConnection(async (conn) => {
      const campos: string[] = [];
      const valores: string[] = [];

      if (cambios.headline !== undefined) {
        campos.push('headline = ?');
        valores.push(cambios.headline);
      }
      if (cambios.standfirst !== undefined) {
        campos.push('standfirst = ?');
        valores.push(cambios.standfirst);
      }
      if (cambios.body !== undefined) {
        campos.push('body = ?');
        valores.push(cambios.body);
      }
      campos.push('isEdited = TRUE');

      const [resultado] = await conn.execute<ResultSetHeader>(
        `UPDATE NewsletterArticles SET ${campos.join(', ')} WHERE articleId = ?`,
        [...valores, articleId],
      );

      if (resultado.affectedRows === 0) {
        throw new NotFoundException({
          message: 'Article not found',
          errorCode: AppErrorCode.NEWSLETTER_ARTICLE_NOT_FOUND,
        });
      }

      return this.leerArticulo(conn, articleId);
    });
  }

  /**
   * Borra una nota. Sus jugadores se van solos: `NewsletterArticlePlayers`
   * cuelga de `articleId` con ON DELETE CASCADE.
   */
  async deleteArticle(articleId: number): Promise<void> {
    return this.db.withConnection(async (conn) => {
      const [resultado] = await conn.execute<ResultSetHeader>(
        `DELETE FROM NewsletterArticles WHERE articleId = ?`,
        [articleId],
      );

      if (resultado.affectedRows === 0) {
        throw new NotFoundException({
          message: 'Article not found',
          errorCode: AppErrorCode.NEWSLETTER_ARTICLE_NOT_FOUND,
        });
      }
    });
  }

  /**
   * Reemplaza la fila única de NewsletterConfig entera. Es un PUT: los cuatro
   * campos viajan siempre, y `groupLore`/`styleGuide` en `null` los vacía.
   */
  async updateConfig(datos: NewsletterConfigRow): Promise<NewsletterConfigRow> {
    return this.db.withConnection(async (conn) => {
      await conn.execute(
        `UPDATE NewsletterConfig
            SET paperName = ?, groupLore = ?, styleGuide = ?, isEnabled = ?
          WHERE configId = 1`,
        [datos.paperName, datos.groupLore, datos.styleGuide, datos.isEnabled],
      );

      const [filas] = await conn.execute<ConfigDB[] & RowDataPacket[]>(
        `SELECT paperName, groupLore, styleGuide, isEnabled
           FROM NewsletterConfig
          WHERE configId = 1`,
      );

      const fila = filas[0];
      if (!fila) {
        // Inalcanzable: la fila la siembra el DDL y el CHECK impide borrarla.
        throw new InternalServerErrorException('Falta la fila de NewsletterConfig');
      }

      return fila;
    });
  }

  /**
   * Una nota releída sola, con sus jugadores. La usa `updateArticle` para
   * devolver la entidad completa sin volver a armar la edición entera.
   */
  private async leerArticulo(conn: PoolConnection, articleId: number): Promise<Article> {
    const [articles] = await conn.execute<ArticleDB[] & RowDataPacket[]>(
      `SELECT articleId, section, headline, standfirst, body, sortOrder, isEdited
         FROM NewsletterArticles
        WHERE articleId = ?`,
      [articleId],
    );

    const article = articles[0];
    if (!article) {
      // Inalcanzable: se acaba de actualizar esta misma fila en esta conexión.
      throw new InternalServerErrorException(`La nota ${articleId} no se pudo releer`);
    }

    const [players] = await conn.execute<ArticlePlayerDB[] & RowDataPacket[]>(
      `SELECT ap.articleId, ap.playerId, ap.role, p.displayName, p.photo
         FROM NewsletterArticlePlayers ap
         INNER JOIN vPlayerDetail p ON p.playerId = ap.playerId
        WHERE ap.articleId = ?
        ORDER BY ap.playerId`,
      [articleId],
    );

    return NewsletterFactory.toArticle(
      article,
      players.map((player) => NewsletterFactory.toArticlePlayer(player)),
    );
  }

  /**
   * Las notas y sus jugadores, en el orden en que vinieron.
   *
   * Una nota por INSERT y no un multi-row: hace falta el `insertId` de cada una
   * para colgarle sus jugadores. Los jugadores de una nota SÍ van en un solo
   * INSERT con varios VALUES, que es donde el multi-row rinde.
   *
   * `sortOrder` es el índice del arreglo, y el arreglo ya viene ordenado por el
   * validador con la portada primera. Que el orden del diario sea el orden del
   * arreglo —y no algo que se recalcule acá— es lo que hace que lo que se leyó
   * en el dry-run sea lo que se ve en la pantalla.
   */
  private async insertarNotas(
    conn: PoolConnection,
    editionId: number,
    notas: NotaValidada[],
  ): Promise<void> {
    for (const [indice, nota] of notas.entries()) {
      const [resultado] = await conn.execute<ResultSetHeader>(
        `INSERT INTO NewsletterArticles
                (editionId, section, headline, standfirst, body, sortOrder)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [editionId, nota.seccion, nota.titular, nota.copete, nota.cuerpo, indice],
      );

      if (nota.jugadores.length === 0) continue;

      // Los placeholders se arman con la cantidad de jugadores y los valores
      // van aparte: interpolar el `(?, ?, ?)` es contar filas, no meter datos.
      // Los repetidos ya los unificó el validador —la PK es (articleId,
      // playerId)— así que acá no puede saltar un ER_DUP_ENTRY.
      const placeholders = nota.jugadores.map(() => '(?, ?, ?)').join(', ');
      // `SqlParam` no sirve acá: admite `undefined`, que `execute` rechaza —lo
      // convierte a null el DatabaseService, y estas consultas no pasan por él.
      const valores: Array<number | string> = nota.jugadores.flatMap((jugador) => [
        resultado.insertId,
        jugador.playerId,
        jugador.rol,
      ]);

      await conn.execute(
        `INSERT INTO NewsletterArticlePlayers (articleId, playerId, role)
         VALUES ${placeholders}`,
        valores,
      );
    }
  }

  /**
   * Una edición recién escrita, releída entera con la conexión de la
   * transacción. Es lo que devuelven las dos escrituras.
   */
  private async leerEdicion(conn: PoolConnection, editionId: number): Promise<Edition> {
    const [filas] = await conn.execute<EditionDB[] & RowDataPacket[]>(
      `SELECT e.editionId, e.editionNumber,
              DATE_FORMAT(e.publishedOn, '%Y-%m-%d') AS publishedOn, e.publishedAt
         FROM NewsletterEditions e
        WHERE e.editionId = ?`,
      [editionId],
    );

    const fila = filas[0];
    if (!fila) {
      // Inalcanzable: la fila se acaba de escribir en esta misma transacción.
      // Está para que el tipo sea `Edition` y no `Edition | null`, que
      // obligaría a todo el flujo de arriba a manejar un null imposible.
      throw new InternalServerErrorException(`La edición ${editionId} no se pudo releer`);
    }

    return this.loadEdition(conn, fila);
  }

  /**
   * El cuerpo compartido de `findLastEdition` y `findEditionBefore`.
   *
   * El `DATE_FORMAT` NO es cosmético y no se puede sacar: ver la nota de
   * `findLastEdition`.
   */
  private async leerEdicionAnterior(
    conn: PoolConnection,
    antesDe: string | null,
  ): Promise<LastEdition | null> {
    const filtro = antesDe === null ? '' : 'WHERE e.publishedOn < ?';
    const parametros: string[] = antesDe === null ? [] : [antesDe];

    const [filas] = await conn.execute<LastEditionDB[] & RowDataPacket[]>(
      `SELECT e.editionId, e.editionNumber,
              DATE_FORMAT(e.publishedOn, '%Y-%m-%d') AS publishedOn,
              e.lastMatchId, e.snapshotVersion, e.snapshot
         FROM NewsletterEditions e
         ${filtro}
        ORDER BY e.publishedOn DESC
        LIMIT 1`,
      parametros,
    );

    const fila = filas[0];
    return fila ? NewsletterFactory.toLastEdition(fila) : null;
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
