import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EnvironmentVariables } from './env.validation';

/**
 * Unico punto de lectura de la configuracion en toda la aplicacion.
 *
 * Envuelve al ConfigService de Nest para devolver el valor YA TIPADO: `get`
 * solo acepta claves declaradas en EnvironmentVariables, y el tipo de retorno
 * es el de esa clave. Un typo no compila, y nadie tiene que acordarse de si
 * PORT venia como string o como number.
 *
 * Ningun otro archivo lee `process.env`.
 */
@Injectable()
export class GlobalsService {
  constructor(private readonly configService: ConfigService<EnvironmentVariables, true>) {}

  get<K extends keyof EnvironmentVariables>(key: K): EnvironmentVariables[K] {
    return this.configService.get(key, { infer: true });
  }

  /**
   * CORS_ORIGIN admite una lista separada por comas; el resto de la aplicacion
   * la quiere como array. La normalizacion vive aca y no en el bootstrap para
   * que el formato de la variable sea asunto de este servicio.
   */
  get corsOrigins(): string[] {
    return this.get('CORS_ORIGIN')
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0);
  }
}
