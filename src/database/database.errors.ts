import type { QueryError } from 'mysql2/promise';

// ─────────────────────────── Runtime error type ──────────────────────────────

/**
 * Extension de QueryError con los campos que mysql2 emite en runtime pero que
 * no estan en las tipificaciones oficiales.
 */
export interface MysqlRuntimeError extends QueryError {
  /**
   * Siempre presente en un error de mysql2 — `isMysqlError` lo garantiza. Se
   * re-declara como obligatorio porque QueryError lo hereda opcional de
   * NodeJS.ErrnoException. Con un SIGNAL, lleva el MYSQL_ERRNO del SP.
   */
  errno: number;
  sqlState?: string;
  sqlMessage?: string;
}

/**
 * Type guard para detectar errores originados en mysql2.
 *
 * Discrimina por `errno` numerico: lo tienen todos los errores de mysql2 y no
 * los de Node (fs, net, etc.), que traen `code` string pero no `errno`.
 *
 * No puede exigir que `code` sea string: cuando un SP hace SIGNAL fijando un
 * MYSQL_ERRNO propio, mysql2 no encuentra ese numero en su tabla de errores
 * conocidos y deja `code` en undefined. Exigirlo haria que todo error de
 * negocio se escapara del mapeo y saliera como 500.
 */
export function isMysqlError(e: unknown): e is MysqlRuntimeError {
  return (
    typeof e === 'object' &&
    e !== null &&
    'errno' in e &&
    typeof (e as QueryError).errno === 'number'
  );
}

// ─────────────────────────── MySQL native error codes ─────────────────────────

/**
 * Codigos de error nativos de MySQL, organizados por categoria.
 * Ref: https://dev.mysql.com/doc/mysql-errors/8.0/en/server-error-reference.html
 */
export const MysqlErrorCode = {
  // ── Constraints ──
  DUP_ENTRY: 'ER_DUP_ENTRY',
  NO_REFERENCED_ROW: 'ER_NO_REFERENCED_ROW_2',
  ROW_IS_REFERENCED: 'ER_ROW_IS_REFERENCED_2',
  BAD_NULL_ERROR: 'ER_BAD_NULL_ERROR',
  DATA_TOO_LONG: 'ER_DATA_TOO_LONG',
  TRUNCATED_WRONG_VALUE: 'ER_TRUNCATED_WRONG_VALUE_FOR_FIELD',
  OUT_OF_RANGE: 'ER_WARN_DATA_OUT_OF_RANGE',
  CHECK_CONSTRAINT_VIOLATED: 'ER_CHECK_CONSTRAINT_VIOLATED',

  // ── Locks / Deadlocks ──
  LOCK_WAIT_TIMEOUT: 'ER_LOCK_WAIT_TIMEOUT',
  LOCK_DEADLOCK: 'ER_LOCK_DEADLOCK',

  // ── Access ──
  ACCESS_DENIED: 'ER_ACCESS_DENIED_ERROR',
  DBACCESS_DENIED: 'ER_DBACCESS_DENIED_ERROR',

  // ── Schema / Tables ──
  NO_SUCH_TABLE: 'ER_NO_SUCH_TABLE',
  BAD_FIELD: 'ER_BAD_FIELD_ERROR',

  // ── Stored procedures ──
  SP_DOES_NOT_EXIST: 'ER_SP_DOES_NOT_EXIST',
  SP_WRONG_NO_OF_ARGS: 'ER_SP_WRONG_NO_OF_ARGS',
  SIGNAL_EXCEPTION: 'ER_SIGNAL_EXCEPTION',

  // ── Connection ──
  SERVER_SHUTDOWN: 'ER_SERVER_SHUTDOWN',
  CONNECTION_LOST: 'PROTOCOL_CONNECTION_LOST',
  CONN_HOST_ERROR: 'ER_CONN_HOST_ERROR',
} as const;

export type MysqlErrorCodeValue = (typeof MysqlErrorCode)[keyof typeof MysqlErrorCode];

// ─────────────────────────── SP custom SQLSTATE ranges ────────────────────────

/**
 * Rangos de SQLSTATE que los stored procedures emiten via
 * `SIGNAL SQLSTATE 'XXXXX' SET MYSQL_ERRNO = N, MESSAGE_TEXT = '...'`.
 *
 * El SQLSTATE define la CATEGORIA (y con ella el HTTP status); el MYSQL_ERRNO
 * define el codigo concreto. Ver sp-error-codes.constants.ts.
 */
export const SpErrorState = {
  /** Validacion generica de negocio. */
  VALIDATION: 45000,
  /** Entidad no encontrada. */
  NOT_FOUND: 45001,
  /** Conflicto de unicidad / la entidad esta en uso. */
  CONFLICT: 45002,
  /** Estado invalido para la operacion. */
  INVALID_STATE: 45003,
  /** Accion no permitida. */
  FORBIDDEN: 45004,
  /** Credencial invalida o vencida. */
  UNAUTHORIZED: 45005,
} as const;

export type SpErrorStateValue = (typeof SpErrorState)[keyof typeof SpErrorState];

// ─────────────────────────── Normalized error codes (i18n) ───────────────────

/**
 * Codigos normalizados que se asignan como `errorCode` cuando un error nativo
 * de MySQL escapa sin ser catcheado por el SP.
 *
 * Si el SP si lo catchea y hace SIGNAL con su propio codigo (ej:
 * TOURNAMENT_NAME_ALREADY_EXISTS), ese tiene prioridad. Estos son fallback.
 */
export const NativeErrorCode = {
  DUPLICATE_ENTRY: 'DUPLICATE_ENTRY',
  REFERENCED_ENTITY_NOT_FOUND: 'REFERENCED_ENTITY_NOT_FOUND',
  ENTITY_IN_USE: 'ENTITY_IN_USE',
  REQUIRED_FIELD_MISSING: 'REQUIRED_FIELD_MISSING',
  DATA_TOO_LONG: 'DATA_TOO_LONG',
  INVALID_DATA: 'INVALID_DATA',
  SERVICE_BUSY: 'SERVICE_BUSY',
  ACCESS_DENIED: 'ACCESS_DENIED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type NativeErrorCodeValue = (typeof NativeErrorCode)[keyof typeof NativeErrorCode];
