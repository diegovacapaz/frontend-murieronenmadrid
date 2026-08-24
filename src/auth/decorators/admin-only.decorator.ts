import { SetMetadata } from '@nestjs/common';

export const ADMIN_ONLY_KEY = 'adminOnly';

/**
 * Lo inverso de `@Public()`: exige el token de admin también en lectura.
 *
 * El AdminGuard decide por método HTTP —leer es libre, escribir exige token—
 * y esa regla es correcta para todo el sistema salvo un caso: un `GET` que
 * devuelve algo que el grupo no tiene que ver. Hoy es el lore de los
 * jugadores, que es el material con el que el diario se burla de ellos.
 *
 * Se usa con moderación. Si un día hay tres de estos, la regla del guard
 * dejó de describir al sistema y hay que repensarla, no seguir marcando
 * excepciones.
 */
export const AdminOnly = () => SetMetadata(ADMIN_ONLY_KEY, true);
