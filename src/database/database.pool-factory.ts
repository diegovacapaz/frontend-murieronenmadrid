import { Logger } from '@nestjs/common';
import type { PoolConnection as CallbackPoolConnection } from 'mysql2';
import { createPool, Pool } from 'mysql2/promise';
import { GlobalsService } from '../globals/globals.service';

/** Shape del campo que mysql2 pasa al callback de typeCast. */
interface TypeCastField {
  type: string;
  length: number;
  string(): string | null;
  buffer(): Buffer | null;
}

/**
 * Casting personalizado de tipos MySQL -> JavaScript, campo por campo, antes de
 * entregar las filas al repository.
 *
 * DATETIME/TIMESTAMP: MySQL emite "YYYY-MM-DD HH:MM:SS" sin offset. Se parsean
 *   con sufijo `Z` explicito para forzar UTC, independiente del TZ del proceso.
 *
 * NEWDECIMAL: se convierte a Number. El backend de referencia los deja como
 *   string porque maneja plata y ahi un redondeo silencioso es un bug contable.
 *   Aca no hay plata: los DECIMAL que aparecen son subproductos de SUM() y
 *   AVG() sobre enteros, y devolverlos como string obligaria al frontend a
 *   parsear cada contador. Los puntos, que son el dato delicado, viajan como
 *   DOUBLE nativo y no pasan por esta rama.
 *
 * TINY(1): BOOLEAN de MySQL. Sin esto llegaria como 0/1 y todo el codigo
 *   tendria que compararlo con === 1.
 *
 * JSON: llega como buffer; se parsea aca para que las columnas armadas con
 *   JSON_ARRAYAGG (convocatorias, titulos) lleguen como objetos.
 */
function typeCast(field: TypeCastField, next: () => unknown): unknown {
  if (field.type === 'NEWDECIMAL') {
    const value = field.string();
    return value === null ? null : Number(value);
  }
  if (field.type === 'DATETIME' || field.type === 'TIMESTAMP') {
    const value = field.string();
    if (!value) return null;
    return new Date(value.replace(' ', 'T') + 'Z');
  }
  if (field.type === 'TINY' && field.length === 1) {
    const value = field.string();
    return value !== null ? value === '1' : null;
  }
  if (field.type === 'JSON') {
    const buf = field.buffer();
    return buf ? (JSON.parse(buf.toString('utf8')) as unknown) : null;
  }
  return next();
}

/**
 * Crea el pool de conexiones y valida la conectividad al arrancar: si la base
 * no esta, el proceso muere en el bootstrap y no sirviendo 500 request por
 * request.
 *
 * UTC-only: cada sesion del pool se inicializa con `SET time_zone='+00:00'` y
 * el driver serializa los `Date` como literales UTC (`timezone: 'Z'`).
 */
export async function createDatabasePool(config: GlobalsService): Promise<Pool> {
  const logger = new Logger('DatabaseModule');

  const pool = createPool({
    host: config.get('MYSQL_HOST'),
    port: config.get('MYSQL_PORT'),
    user: config.get('MYSQL_USER'),
    password: config.get('MYSQL_PASSWORD'),
    database: config.get('MYSQL_DATABASE'),
    connectionLimit: 15,
    waitForConnections: true,
    queueLimit: 0,
    idleTimeout: 30000,
    connectTimeout: 60000,
    timezone: 'Z',
    typeCast,
  });

  pool.on('connection', (connection) => {
    // El evento entrega la conexion callback-style (no el wrapper promise):
    // aca .query() NO devuelve Promise, hay que usar la API de callback.
    (connection as unknown as CallbackPoolConnection).query(
      "SET time_zone = '+00:00'",
      (err) => {
        if (err) {
          logger.error('Failed to SET time_zone=UTC on new pooled connection', err);
        }
      },
    );
  });

  const connection = await pool.getConnection();
  connection.release();

  logger.log('Database connection established (timezone=UTC)');

  return pool;
}
