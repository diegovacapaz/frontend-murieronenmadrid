import {
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';
import type { Pool, PoolConnection } from 'mysql2/promise';
import { DATABASE_POOL } from './database.constants';
import { handleDatabaseError } from './database.error-map';
import { ResultSetHeader, Row, SqlParams } from './database.types';

/**
 * Unico punto de acceso al pool de MySQL en toda la aplicacion.
 *
 * Responsabilidades:
 * - Encapsular el pool singleton del token DATABASE_POOL.
 * - Invocar stored procedures de forma tipada (callSimple, callList, callMulti).
 * - Manejar el lifecycle de las conexiones (getConnection -> release en finally).
 * - Delegar el mapeo de errores a `handleDatabaseError`.
 * - Cerrar el pool en el shutdown.
 *
 * No conoce DTOs ni entidades: recibe primitivos y devuelve filas crudas. La
 * traduccion a dominio es trabajo de las factories de cada modulo.
 */
@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);

  private static readonly SP_NAME_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  // ─────────────────────────── Connection lifecycle ───────────────────────────

  /**
   * Ejecuta `fn` con una conexion del pool, garantizando try/catch/finally.
   * Los errores pasan por handleDatabaseError (que lanza excepciones de Nest).
   */
  async withConnection<T>(fn: (connection: PoolConnection) => Promise<T>): Promise<T> {
    const connection = await this.pool.getConnection();
    try {
      return await fn(connection);
    } catch (error) {
      return handleDatabaseError(error);
    } finally {
      connection.release();
    }
  }

  /**
   * Ejecuta `fn` dentro de una transaccion, con rollback garantizado.
   *
   * Existe porque `withConnection` no puede darlo: su `finally` libera la
   * conexion, y si la excepcion salto con una transaccion abierta, esa conexion
   * vuelve al pool sucia y el proximo que la tome hereda el problema. Aca el
   * rollback pasa ANTES del release.
   *
   * Los errores siguen pasando por handleDatabaseError, como en withConnection:
   * quien llama recibe una excepcion de Nest, no una de mysql2.
   */
  async withTransaction<T>(fn: (connection: PoolConnection) => Promise<T>): Promise<T> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await fn(connection);
      await connection.commit();
      return result;
    } catch (error) {
      // El `.catch` no es descuido: si la conexion ya se cayo, el rollback
      // tambien falla, y lo que hay que propagar es el error original —el que
      // explica que paso— no el del rollback.
      await connection.rollback().catch(() => undefined);
      return handleDatabaseError(error);
    } finally {
      connection.release();
    }
  }

  // ─────────────────────────── Stored procedure callers ───────────────────────

  /**
   * SP que devuelve un unico result set con exactamente una fila.
   * Throwea si el SP no devolvio ninguna: quien llama espera un objeto.
   */
  async callSimple<T extends Row>(sp: string, params: SqlParams = []): Promise<T> {
    return this.withConnection(async (conn) => {
      const rows = await this.execCall<T>(conn, sp, params);
      const first = rows[0];
      if (!first) {
        throw new InternalServerErrorException(`SP ${sp} returned empty result set`);
      }
      return first;
    });
  }

  /**
   * Variante de callSimple que admite que el SP no devuelva filas.
   * Retorna null si el result set esta vacio — el service decide si eso es 404.
   */
  async callSimpleOrNull<T extends Row>(
    sp: string,
    params: SqlParams = [],
  ): Promise<T | null> {
    return this.withConnection(async (conn) => {
      const rows = await this.execCall<T>(conn, sp, params);
      return rows[0] ?? null;
    });
  }

  /** SP que devuelve un unico result set con N filas. */
  async callList<T extends Row>(sp: string, params: SqlParams = []): Promise<T[]> {
    return this.withConnection((conn) => this.execCall<T>(conn, sp, params));
  }

  /**
   * SP que devuelve N result sets, con tipado de tupla.
   *
   * Uso:
   *   const [summary, perTournament] = await db.callMulti<[SummaryDB[], TourDB[]]>(
   *     'GetPlayerStats', [id, 5, 5],
   *   );
   *
   * El ultimo elemento que devuelve mysql2 en un CALL es el ResultSetHeader del
   * procedimiento, no un result set: por eso el slice.
   */
  async callMulti<TResults extends Row[][]>(
    sp: string,
    params: SqlParams = [],
  ): Promise<TResults> {
    return this.withConnection(async (conn) => {
      const raw = await this.execCallRaw(conn, sp, params);
      if (!Array.isArray(raw)) {
        throw new InternalServerErrorException(
          `SP ${sp} did not return multiple result sets`,
        );
      }
      return raw.slice(0, -1) as TResults;
    });
  }

  /**
   * SP que no devuelve result sets (solo DML interno).
   * Retorna el ResultSetHeader con insertId, affectedRows, etc.
   */
  async callExec(sp: string, params: SqlParams = []): Promise<ResultSetHeader> {
    return this.withConnection(async (conn) => {
      const raw = await this.execCallRaw(conn, sp, params);
      if (Array.isArray(raw)) {
        return raw[raw.length - 1] as ResultSetHeader;
      }
      return raw as ResultSetHeader;
    });
  }

  // ─────────────────────────── Private helpers ─────────────────────────────────

  private async execCallRaw(
    connection: PoolConnection,
    sp: string,
    params: SqlParams,
  ): Promise<unknown> {
    // El nombre del SP se interpola en el SQL (no puede ir como placeholder),
    // asi que se valida contra un identificador estricto. Hoy todos los nombres
    // son literales del codigo, pero el dia que uno salga de una variable esta
    // guarda ya esta puesta.
    if (!DatabaseService.SP_NAME_REGEX.test(sp)) {
      throw new InternalServerErrorException(`Invalid SP name: ${sp}`);
    }

    const placeholders = params.map(() => '?').join(', ');
    const paramsWithNulls: Array<string | number | boolean | Date | Buffer | null> =
      params.map((p) => p ?? null);
    const sql = `CALL ${sp}(${placeholders});`;

    const [rawResult] = await connection.execute(sql, paramsWithNulls);
    return rawResult;
  }

  private async execCall<T extends Row>(
    connection: PoolConnection,
    sp: string,
    params: SqlParams,
  ): Promise<T[]> {
    const raw = await this.execCallRaw(connection, sp, params);

    if (!Array.isArray(raw)) {
      throw new InternalServerErrorException(`SP ${sp} did not return a result set`);
    }

    const firstResultSet = raw[0] as unknown;
    if (!Array.isArray(firstResultSet)) {
      return [];
    }

    return firstResultSet as T[];
  }

  // ─────────────────────────── Lifecycle ───────────────────────────────────────

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
    this.logger.log('Database pool closed');
  }
}
