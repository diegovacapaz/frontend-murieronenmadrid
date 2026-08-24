import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';

// ─────────────────────────── Parametros de SP ─────────────────────────────────

/**
 * Valores admisibles como parametros de un stored procedure. Coinciden con los
 * que mysql2 acepta en `connection.execute()`, mas `undefined`, que el
 * DatabaseService convierte a `null`.
 *
 * Para pasar objetos o arrays a un SP hay que serializarlos con JSON.stringify
 * antes: el SP los desarma con JSON_TABLE (asi viaja la convocatoria de un
 * partido, por ejemplo).
 */
export type SqlParam = string | number | boolean | Date | Buffer | null | undefined;

export type SqlParams = readonly SqlParam[];

// ─────────────────────────── Result set types ─────────────────────────────────

/**
 * Shape base de cualquier fila de result set. Los repositories extienden esta
 * interfaz con sus columnas concretas (ver `interfaces/database.ts` de cada
 * modulo).
 */
export type Row = RowDataPacket & Record<string, unknown>;

/**
 * Re-exports de mysql2 para que ningun archivo fuera de src/database/ importe
 * del driver directamente.
 *
 * PoolConnection esta aca por los repositories que usan `withConnection` y
 * parten la consulta en un helper privado: ese helper necesita tipar la
 * conexion que recibe.
 */
export type { PoolConnection, ResultSetHeader, RowDataPacket };
