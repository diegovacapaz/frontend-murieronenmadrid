import { ConflictException } from '@nestjs/common';
import { AppErrorCode } from '../../common/constants/error-codes.constants';
import { ErrorParaElRedactor } from '../../mcp/errores';

/**
 * Un error de negocio del MCP del Powerade. Su `message` lo lee un modelo: ver
 * `ErrorParaElRedactor`.
 */
export class PoweradeMcpError extends ErrorParaElRedactor {
  constructor(mensajeParaElRedactor: string) {
    super(mensajeParaElRedactor);
    this.name = 'PoweradeMcpError';
  }
}

/**
 * El reemplazo de una versión no se hizo porque otra conversación publicó antes:
 * la `revision` ya no es la del borrador.
 *
 * **Extiende `ConflictException` y no `Error` a propósito.** El repositorio lo
 * lanza desde adentro de `withTransaction`, que pasa todo error por
 * `handleDatabaseError`: un `Error` común se convertiría ahí en un 500 genérico y
 * el servicio no podría distinguir "alguien publicó en el medio" de "se cayó la
 * base". Una `HttpException` atraviesa ese manejo sin cambios.
 */
export class PoweradeConflictoError extends ConflictException {
  constructor() {
    super({
      message: 'La versión del ranking cambió mientras se escribía',
      errorCode: AppErrorCode.POWERADE_VERSION_CONFLICT,
    });
  }
}
