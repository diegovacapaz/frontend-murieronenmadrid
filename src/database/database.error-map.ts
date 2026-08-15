import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
  type Type,
} from '@nestjs/common';
import {
  MysqlErrorCode,
  MysqlRuntimeError,
  NativeErrorCode,
  NativeErrorCodeValue,
  SpErrorState,
  isMysqlError,
} from './database.errors';
import { appErrorCodeFromErrno } from './sp-error-codes.constants';

// ─────────────────────────── Types ───────────────────────────────────────────

interface NativeErrorMapping {
  exception: Type<HttpException>;
  errorCode: NativeErrorCodeValue;
  defaultMessage: string;
}

// ─────────────────────────── SIGNAL state → HttpException ────────────────────

/**
 * Mapeo SQLSTATE -> HttpException para los SIGNAL de los SPs.
 *
 * Para agregar un rango nuevo: una linea aca y la constante correspondiente en
 * SpErrorState (database.errors.ts).
 */
export const SIGNAL_STATE_MAP: Record<number, Type<HttpException>> = {
  [SpErrorState.VALIDATION]: BadRequestException,
  [SpErrorState.NOT_FOUND]: NotFoundException,
  [SpErrorState.CONFLICT]: ConflictException,
  [SpErrorState.INVALID_STATE]: BadRequestException,
  [SpErrorState.FORBIDDEN]: ForbiddenException,
  [SpErrorState.UNAUTHORIZED]: UnauthorizedException,
};

// ─────────────────────────── Native MySQL error → HttpException ──────────────

/**
 * Mapeo error nativo de MySQL -> { Exception, errorCode, defaultMessage }.
 *
 * Solo se usa cuando el error escapa sin ser catcheado por el SP. `errorCode`
 * es la clave de i18n; `defaultMessage` es el texto legible que va en `message`.
 */
export const NATIVE_ERROR_MAP: Record<string, NativeErrorMapping> = {
  // ── Constraints ──
  [MysqlErrorCode.DUP_ENTRY]: {
    exception: ConflictException,
    errorCode: NativeErrorCode.DUPLICATE_ENTRY,
    defaultMessage: 'Duplicate entry',
  },
  [MysqlErrorCode.NO_REFERENCED_ROW]: {
    exception: BadRequestException,
    errorCode: NativeErrorCode.REFERENCED_ENTITY_NOT_FOUND,
    defaultMessage: 'Referenced entity does not exist',
  },
  [MysqlErrorCode.ROW_IS_REFERENCED]: {
    exception: ConflictException,
    errorCode: NativeErrorCode.ENTITY_IN_USE,
    defaultMessage: 'Entity is referenced and cannot be removed',
  },
  [MysqlErrorCode.BAD_NULL_ERROR]: {
    exception: BadRequestException,
    errorCode: NativeErrorCode.REQUIRED_FIELD_MISSING,
    defaultMessage: 'A required field is missing',
  },
  [MysqlErrorCode.DATA_TOO_LONG]: {
    exception: BadRequestException,
    errorCode: NativeErrorCode.DATA_TOO_LONG,
    defaultMessage: 'Data exceeds maximum allowed length',
  },
  [MysqlErrorCode.TRUNCATED_WRONG_VALUE]: {
    exception: BadRequestException,
    errorCode: NativeErrorCode.INVALID_DATA,
    defaultMessage: 'Invalid data format',
  },
  [MysqlErrorCode.OUT_OF_RANGE]: {
    exception: BadRequestException,
    errorCode: NativeErrorCode.INVALID_DATA,
    defaultMessage: 'Value out of allowed range',
  },
  [MysqlErrorCode.CHECK_CONSTRAINT_VIOLATED]: {
    exception: BadRequestException,
    errorCode: NativeErrorCode.INVALID_DATA,
    defaultMessage: 'Value violates a table constraint',
  },

  // ── Locks ──
  [MysqlErrorCode.LOCK_WAIT_TIMEOUT]: {
    exception: ServiceUnavailableException,
    errorCode: NativeErrorCode.SERVICE_BUSY,
    defaultMessage: 'Service is temporarily busy, please retry',
  },
  [MysqlErrorCode.LOCK_DEADLOCK]: {
    exception: ServiceUnavailableException,
    errorCode: NativeErrorCode.SERVICE_BUSY,
    defaultMessage: 'Service is temporarily busy, please retry',
  },
};

// ─────────────────────────── Handler function ────────────────────────────────

const logger = new Logger('DatabaseErrorHandler');

/**
 * Mapea errores de mysql2 y errores inesperados a excepciones de Nest.
 * Nunca retorna — siempre throw.
 *
 * Flujo:
 *  1. HttpException ya mapeada -> rethrow.
 *  2. SIGNAL de un SP (sqlState >= 45000) -> SQLSTATE define el status y el
 *     MYSQL_ERRNO se traduce a AppErrorCode.
 *  3. Error nativo mapeado (duplicado, FK, locks) -> HttpException con codigo
 *     normalizado.
 *  4. Cualquier otra cosa -> 500 + log. Nunca se filtra un mensaje de MySQL al
 *     cliente: puede exponer nombres de tablas y columnas.
 */
export function handleDatabaseError(error: unknown): never {
  if (error instanceof HttpException) {
    throw error;
  }

  if (isMysqlError(error)) {
    const sqlState = Number(error.sqlState);

    // ── SIGNAL de un SP (SQLSTATE 45000+) ──
    if (Number.isFinite(sqlState) && sqlState >= 45000) {
      throwSignalError(sqlState, error);
    }

    // ── Error nativo mapeado ──
    const nativeMapping = error.code && NATIVE_ERROR_MAP[error.code];
    if (nativeMapping) {
      logger.warn(`Native DB error ${error.code}: ${error.message}`);
      throw new nativeMapping.exception({
        message: nativeMapping.defaultMessage,
        errorCode: nativeMapping.errorCode,
      });
    }

    // ── Error nativo NO mapeado -> 500 ──
    logger.error(
      `Unmapped DB error ${error.code} sqlState=${error.sqlState}: ${error.message}`,
    );
    throw new InternalServerErrorException({
      message: 'Database error',
      errorCode: NativeErrorCode.INTERNAL_ERROR,
    });
  }

  // ── Error no-mysql -> 500 ──
  logger.error(
    'Unexpected error in database call',
    error instanceof Error ? error.stack : String(error),
  );
  throw new InternalServerErrorException({
    message: 'Unexpected system error',
    errorCode: NativeErrorCode.INTERNAL_ERROR,
  });
}

/**
 * Lanza la HttpException correspondiente a un SIGNAL de un SP.
 *
 * Todo SP debe emitir un MYSQL_ERRNO catalogado; si no lo hace, o si el numero
 * no esta en el catalogo, se responde 500 sin exponer nada y se loguea para que
 * el hueco se corrija. Un error de negocio silencioso es peor que uno ruidoso.
 *
 * El MESSAGE_TEXT nunca viaja al cliente: solo se loguea.
 */
function throwSignalError(sqlState: number, error: MysqlRuntimeError): never {
  const errorCode = appErrorCodeFromErrno(error.errno);

  if (!errorCode) {
    logger.error(
      `SP emitio un SIGNAL sin codigo catalogado ` +
        `(sqlState=${sqlState}, errno=${error.errno}): ${error.sqlMessage ?? ''}`,
    );
    throw new InternalServerErrorException({
      message: 'Database error',
      errorCode: NativeErrorCode.INTERNAL_ERROR,
    });
  }

  const ExceptionClass = SIGNAL_STATE_MAP[sqlState] ?? BadRequestException;
  throw new ExceptionClass({ message: errorCode, errorCode });
}
