import { HttpException } from '@nestjs/common';
import { NativeErrorCode, isMysqlError } from './database.errors';

/**
 * ¿Este error es "Duplicate entry" (un UNIQUE que saltó)?
 *
 * Existe porque el error NO llega crudo a quien llama: `withTransaction` y
 * `withConnection` pasan todo por `handleDatabaseError`, que convierte el 1062
 * de MySQL en una `ConflictException` con el código `DUPLICATE_ENTRY`. Mirar
 * sólo `errno === 1062` —que es lo que parece natural— no detecta nada cuando
 * el error viene de una consulta del repositorio.
 *
 * Reconoce las dos formas: la excepción ya traducida (la que llega en la
 * práctica) y el error crudo de mysql2 (lo que se ve en un test o si algún día
 * se llama sin pasar por esos wrappers).
 */
export function esEntradaDuplicada(error: unknown): boolean {
  if (error instanceof HttpException) {
    const respuesta = error.getResponse();
    return (
      typeof respuesta === 'object' &&
      respuesta !== null &&
      (respuesta as { errorCode?: unknown }).errorCode === NativeErrorCode.DUPLICATE_ENTRY
    );
  }

  return isMysqlError(error) && error.errno === 1062;
}
