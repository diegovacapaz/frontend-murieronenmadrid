import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Envelope estandar de TODAS las respuestas de la API — lo aplica
 * `ApiResponseInterceptor` en runtime y `bootstrap` lo refleja en el schema
 * OpenAPI de cada 2xx, para que la documentacion no mienta.
 *
 * El archivo NO termina en `.dto.ts` a proposito: asi el plugin de Swagger no
 * lo procesa. `data` es generico y el plugin lo interpretaria como dependencia
 * circular. Es la unica clase anotada a mano — es infraestructura, no un DTO de
 * dominio.
 */
export class ApiResponseDto {
  @ApiProperty({ example: 200 })
  statusCode!: number;

  @ApiProperty({ example: 'Success' })
  message!: string;

  @ApiPropertyOptional({
    description: 'Payload del endpoint (su forma la define cada operacion)',
  })
  data?: unknown;

  @ApiPropertyOptional({
    description: 'Metadata del endpoint. Ausente si la operacion no aporta ninguna',
  })
  meta?: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'Detalle del error (lista de mensajes de validacion)',
  })
  error?: string | string[];

  @ApiPropertyOptional({
    description: 'Clave i18n del error para el frontend',
    example: 'PLAYER_NOT_FOUND',
  })
  errorCode?: string;

  @ApiProperty({ example: '2026-07-22T12:00:00.000Z' })
  timestamp!: string;
}
