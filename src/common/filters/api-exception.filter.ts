import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiResponse } from '../interfaces/api-response.interface';

/**
 * Da formato a TODOS los errores de la API, vengan de donde vengan.
 *
 * Es un filter y no la rama de error de un interceptor por una razon concreta
 * del ciclo de vida de Nest: los guards corren ANTES que los interceptores, asi
 * que un 401 del AdminGuard nunca pasaria por el `catchError` de uno. El
 * resultado seria que los errores de autenticacion salen con una forma y los de
 * negocio con otra — justo la clase de inconsistencia que rompe el manejo de
 * errores del cliente.
 *
 * Un filter, en cambio, atrapa lo que tiren guards, pipes, interceptores y
 * handlers por igual. El interceptor se queda solo con el camino feliz.
 *
 * Forma de salida, identica a la de exito salvo por el codigo:
 * { statusCode, message, error?, errorCode?, timestamp }
 *
 * `errorCode` es lo que el frontend traduce; `message` es para logs y curl.
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    // Los errores de websocket no se responden por HTTP: no hay request al que
    // contestarle. Se loguean y se dejan pasar.
    if (host.getType() !== 'http') {
      this.logger.error(
        'Error fuera del contexto HTTP',
        exception instanceof Error ? exception.stack : String(exception),
      );
      return;
    }

    const response = host.switchToHttp().getResponse<Response>();
    const { statusCode, message, errorCode, error } = this.extractErrorInfo(exception);

    const body: ApiResponse<null> = {
      statusCode,
      message,
      ...(error !== undefined ? { error } : {}),
      ...(errorCode !== undefined ? { errorCode } : {}),
      timestamp: new Date().toISOString(),
    };

    response.status(statusCode).json(body);
  }

  private extractErrorInfo(exception: unknown): {
    statusCode: number;
    message: string;
    errorCode: string | undefined;
    error: string | string[] | undefined;
  } {
    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        return {
          statusCode,
          message: exceptionResponse,
          errorCode: undefined,
          error: undefined,
        };
      }

      if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        const obj = exceptionResponse as Record<string, unknown>;

        // Cuando el ValidationPipe rechaza, `message` es un array de mensajes.
        // Se mueve a `error` y `message` queda como texto unico, para que la
        // forma de la respuesta no cambie segun el tipo de error.
        const message = Array.isArray(obj.message)
          ? 'Validation failed'
          : typeof obj.message === 'string'
            ? obj.message
            : exception.message;

        const error = Array.isArray(obj.message)
          ? (obj.message as string[])
          : Array.isArray(obj.error)
            ? (obj.error as string[])
            : typeof obj.error === 'string'
              ? obj.error
              : undefined;

        const errorCode = typeof obj.errorCode === 'string' ? obj.errorCode : undefined;

        return { statusCode, message, errorCode, error };
      }

      return {
        statusCode,
        message: exception.message,
        errorCode: undefined,
        error: undefined,
      };
    }

    // Todo lo que no sea HttpException es un bug: se loguea entero y al cliente
    // le llega un 500 pelado, sin stack ni detalles internos.
    this.logger.error(
      'Excepcion no controlada',
      exception instanceof Error ? exception.stack : String(exception),
    );

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
      errorCode: undefined,
      error: undefined,
    };
  }
}
