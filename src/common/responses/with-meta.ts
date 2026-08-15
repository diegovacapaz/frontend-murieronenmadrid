import type { ResponseMeta } from '../interfaces/api-response.interface';

/**
 * Envoltorio para que un handler devuelva `data` + `meta` sin que el
 * interceptor tenga que adivinar cual es cual.
 *
 * Se usa cuando la respuesta lleva informacion que no es parte del dato de
 * dominio: por ejemplo el scoreboard de un torneo, que ademas de las filas
 * quiere informar de que torneo son.
 */
export class WithMeta<T> {
  constructor(
    public readonly data: T,
    public readonly meta: ResponseMeta,
  ) {}

  static of<T>(data: T, meta: ResponseMeta): WithMeta<T> {
    return new WithMeta(data, meta);
  }
}
