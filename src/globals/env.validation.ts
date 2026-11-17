import { plainToInstance, Type } from 'class-transformer';
import {
  IsBooleanString,
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

  /**
   * Credencial de la API de Anthropic. OJO: no es la suscripción de Claude.ai
   * ni la de Claude Code — son productos con facturación separada. Esta sale de
   * la Console (console.anthropic.com) y se paga con créditos de API.
   *
   * OPCIONAL desde que el diario puede escribirse por el MCP con la suscripción
   * (ver MCP_API_KEY): sin ella el backend arranca igual, el cron no hace nada y
   * el botón "Generar edición" responde un 409 que explica que el diario se
   * escribe desde Claude. Si viene, tiene que ser una clave de verdad.
   */
  @IsOptional()
  @IsString()
  @MinLength(10)
  ANTHROPIC_API_KEY?: string;

  /**
   * Modelo con el que se escribe el diario. Está acá y no clavado en el código
   * para poder cambiarlo sin deployar.
   *
   * Costo medido con Sonnet 5 sobre la base real (68 partidos, 27 jugadores):
   * unos USD 0,63 por edición con caché de prompt, USD 1,31 sin él. Subirlo a
   * Opus multiplica eso por cinco.
   */
  @IsOptional()
  @IsString()
  NEWSLETTER_MODEL: string = 'claude-sonnet-5';

  /**
   * Corte a nivel proceso. Es el de arriba de los dos: si esto está en false,
   * el cron ni siquiera lee la configuración de la base. Sirve para levantar
   * una copia del backend sin que empiece a gastar plata.
   */
  @IsOptional()
  @IsBooleanString()
  NEWSLETTER_ENABLED: string = 'true';

  /**
   * Clave del servidor MCP (`/mcp`), con el que Claude arma y publica el diario.
   *
   * Es OPCIONAL a propósito: sin ella el MCP queda apagado —`/mcp` ni siquiera
   * existe, devuelve 404— y el backend arranca igual. Así un deploy que no la
   * configure no expone nada. El mínimo de 32 caracteres es porque en la etapa de
   * prueba un túnel público es lo único entre internet y la base: tiene que ser
   * larga y aleatoria.
   */
  @IsOptional()
  @IsString()
  @MinLength(32)
  MCP_API_KEY?: string;
}

/**
 * Las claves OPCIONALES de cuya ausencia depende que un producto quede apagado.
 * Vacías valen como "no configuradas": docker-compose pasa `VAR: ${VAR:-}` como
 * cadena vacía, y `VAR=` en un .env es lo mismo. Sin esto, dejarlas en blanco hacía
 * que el proceso muriera al arrancar por no llegar al largo mínimo.
 *
 * Sólo estas dos: normalizar las obligatorias cambiaría cómo se comporta el
 * resto de la configuración sin que nadie lo haya pedido.
 */
const OPCIONALES_QUE_VACIAS_SON_AUSENTES = ['MCP_API_KEY', 'ANTHROPIC_API_KEY'] as const;

export function validate(entrada: Record<string, unknown>): EnvironmentVariables {
  const config = { ...entrada };
  for (const clave of OPCIONALES_QUE_VACIAS_SON_AUSENTES) {
    if (config[clave] === '') delete config[clave];
  }

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
