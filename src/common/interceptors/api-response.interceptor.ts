import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Response } from 'express';
import { Observable, map } from 'rxjs';
import { RESPONSE_MESSAGE_KEY } from '../decorators/response-message.decorator';
import { ApiResponse, ResponseMeta } from '../interfaces/api-response.interface';
import { WithMeta } from '../responses/with-meta';

const DEFAULT_MESSAGE = 'Success';

/**
 * Envuelve las respuestas EXITOSAS en el envelope ApiResponse<T>:
 *
 * { statusCode: 200, message: "Success", data: {...}, timestamp: "..." }
 *
 * Los errores no pasan por aca: los formatea ApiExceptionFilter, que ademas
 * alcanza a los que tiran los guards (que corren antes que los interceptores).
 * Ver el comentario de ese archivo.
 */
@Injectable()
export class ApiResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const response = context.switchToHttp().getResponse<Response>();

    // @ResponseMessage('...'): reemplaza el "Success" por defecto
    const customMessage = Reflect.getMetadata(
      RESPONSE_MESSAGE_KEY,
      context.getHandler(),
    ) as string | undefined;
    const message = customMessage ?? DEFAULT_MESSAGE;

    return next
      .handle()
      .pipe(
        map(
          (payload): ApiResponse<unknown> =>
            this.buildSuccessBody(payload, response.statusCode, message),
        ),
      );
  }

  private buildSuccessBody(
    payload: unknown,
    statusCode: number,
    message: string,
  ): ApiResponse<unknown> {
    const { data, meta } = this.split(payload);

    return {
      statusCode,
      message,
      data,
      ...(meta ? { meta } : {}),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * `WithMeta` es la unica forma de que un handler aporte metadata; cualquier
   * otro valor va tal cual a `data`.
   */
  private split(payload: unknown): { data: unknown; meta?: ResponseMeta } {
    if (payload instanceof WithMeta) {
      return { data: payload.data, meta: payload.meta };
    }
    return { data: payload };
  }
}
