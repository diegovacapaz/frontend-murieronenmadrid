// DEBE ser el primer import: fija TZ=UTC antes de que se cargue nada mas.
import './globals/timezone-bootstrap';

import { BadRequestException, Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule, getSchemaPath } from '@nestjs/swagger';
import type { OpenAPIObject } from '@nestjs/swagger';
import { ValidationError } from 'class-validator';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AppErrorCode } from './common/constants/error-codes.constants';
import { ApiResponseDto } from './common/dtos/api-response.schema';
import { ApiExceptionFilter } from './common/filters/api-exception.filter';
import { ApiResponseInterceptor } from './common/interceptors/api-response.interceptor';
import { TrimPipe } from './common/pipes/trim.pipe';
import { GlobalsService } from './globals/globals.service';

const DATE_CONVENTION_DESCRIPTION =
  '**Convencion de fechas:** los campos datetime de entrada se interpretan como ' +
  'ISO 8601. Internamente todo se normaliza a UTC (`Date` de JS, columnas ' +
  '`DATETIME` de MySQL) y las respuestas siempre serializan en UTC con sufijo ' +
  '`Z`. La API es agnostica a la zona del servidor: cada sesion de MySQL corre ' +
  "con `SET time_zone='+00:00'` y el runtime arranca con `TZ=UTC`.\n\n" +
  '**Autenticacion:** no hay usuarios. Leer (GET) es libre; escribir (POST, ' +
  'PATCH, DELETE) exige el token que devuelve `POST /api/auth/login`, enviado ' +
  'como `Authorization: Bearer <token>`.\n\n' +
  '**Errores:** toda respuesta trae `errorCode`, una clave estable que el ' +
  'frontend usa para traducir el mensaje al idioma del usuario.';

/** Shape minimo del documento OpenAPI que necesitamos recorrer. */
interface OpenApiResponse {
  content?: Record<string, { schema?: unknown }>;
}

/**
 * `ApiResponseInterceptor` envuelve TODAS las respuestas en `ApiResponseDto`.
 * Aca reflejamos ese envelope en el schema de cada 2xx del documento, para no
 * tener que decorar endpoint por endpoint y que la doc no mienta. El schema del
 * handler (derivado del DTO por el plugin) queda bajo `data`.
 */
function wrapSuccessResponses(document: OpenAPIObject): void {
  for (const pathItem of Object.values(document.paths)) {
    for (const operation of Object.values(pathItem)) {
      const responses = (operation as { responses?: Record<string, unknown> }).responses;
      if (!responses) continue;

      for (const [status, response] of Object.entries(responses)) {
        if (!status.startsWith('2')) continue;

        const typed = response as OpenApiResponse;
        const inner = typed.content?.['application/json']?.schema;

        typed.content = {
          'application/json': {
            schema: {
              allOf: [
                { $ref: getSchemaPath(ApiResponseDto) },
                ...(inner ? [{ properties: { data: inner } }] : []),
              ],
            },
          },
        };
      }
    }
  }
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] });

  const globals = app.get(GlobalsService);

  app.setGlobalPrefix('api');
  app.use(helmet());

  app.enableCors({
    origin: globals.corsOrigins,
    credentials: true,
  });

  app.useGlobalPipes(
    new TrimPipe(),
    new ValidationPipe({
      whitelist: true,
      // Un campo de mas en el body es casi siempre un typo del cliente o un
      // contrato desincronizado: mejor un 400 explicito que ignorarlo en
      // silencio y que el usuario crea que guardo algo que no guardo.
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors: ValidationError[]) => {
        const messages = errors.flatMap((err) => Object.values(err.constraints ?? {}));
        return new BadRequestException({
          message: 'Validation failed',
          error: messages,
          errorCode: AppErrorCode.VALIDATION_FAILED,
        });
      },
    }),
  );

  // El filter va primero por claridad de lectura, pero el orden no importa:
  // son dos caminos disjuntos (exito vs error).
  app.useGlobalFilters(new ApiExceptionFilter());
  app.useGlobalInterceptors(new ApiResponseInterceptor());

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Murieron en Madrid API')
    .setDescription(DATE_CONVENTION_DESCRIPTION)
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig, {
    extraModels: [ApiResponseDto],
  });
  wrapSuccessResponses(document);
  SwaggerModule.setup('docs', app, document);

  // Cierra el pool de MySQL y los sockets en un SIGTERM en vez de cortar
  // conexiones a la mitad.
  app.enableShutdownHooks();

  const port = globals.get('PORT');
  await app.listen(port);

  const logger = new Logger('Bootstrap');
  logger.log(`API escuchando en http://localhost:${port}/api`);
  logger.log(`Swagger en http://localhost:${port}/docs`);
}

void bootstrap();
