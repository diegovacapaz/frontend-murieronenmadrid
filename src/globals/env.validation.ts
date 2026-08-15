import { plainToInstance, Type } from 'class-transformer';
import {
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MinLength,
  validateSync,
} from 'class-validator';

/**
 * Contrato de la .env. Lo que no este declarado aca no existe para la
 * aplicacion, y lo que falte tira el proceso al arrancar en vez de fallar mas
 * tarde con un undefined en medio de un request.
 */
export class EnvironmentVariables {
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  PORT: number = 3000;

  /**
   * Origen del frontend. Acepta varios separados por coma para el caso de
   * tener el sitio y una preview apuntando a la misma API.
   */
  @IsString()
  CORS_ORIGIN!: string;

  @IsString()
  MYSQL_HOST!: string;

  @IsNumber()
  @Type(() => Number)
  MYSQL_PORT!: number;

  @IsString()
  MYSQL_USER!: string;

  @IsString()
  MYSQL_PASSWORD!: string;

  @IsString()
  MYSQL_DATABASE!: string;

  /**
   * Clave unica de administracion. No hay usuarios en este sistema: quien la
   * sabe puede escribir, quien no, solo lee. Se compara en tiempo constante
   * (ver AuthService) y nunca sale de la aplicacion.
   */
  @IsString()
  @MinLength(8)
  ADMIN_PASSWORD!: string;

  /**
   * Secreto con el que se firma el token que devuelve el login. Distinto de
   * ADMIN_PASSWORD a proposito: cambiar el secreto invalida las sesiones
   * abiertas sin obligar a cambiar la clave que la gente memorizo.
   */
  @IsString()
  @MinLength(16)
  ADMIN_TOKEN_SECRET!: string;

  /**
   * Vida del token de admin, en formato `ms`: 15m, 12h, 7d.
   *
   * El regex no es decorativo: `jsonwebtoken` acepta el string sin chequearlo y
   * un valor mal escrito (`12 horas`) lo hace fallar recien al firmar el primer
   * token, es decir cuando alguien intenta entrar. Validado aca, el proceso no
   * arranca con una configuracion rota.
   */
  @IsOptional()
  @IsString()
  @Matches(/^\d+(ms|s|m|h|d|w|y)?$/, {
    message: 'ADMIN_TOKEN_EXPIRES_IN debe tener formato ms (ej: 900s, 15m, 12h, 7d)',
  })
  ADMIN_TOKEN_EXPIRES_IN: string = '12h';
}

export function validate(config: Record<string, unknown>): EnvironmentVariables {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validatedConfig, { skipMissingProperties: false });

  if (errors.length > 0) {
    const messages = errors
      .map((error) => {
        const constraints = error.constraints
          ? Object.values(error.constraints).join(', ')
          : 'unknown error';
        return `${error.property}: ${constraints}`;
      })
      .join('\n');

    throw new Error(`Environment validation failed:\n${messages}`);
  }

  return validatedConfig;
}
