import { SetMetadata } from '@nestjs/common';

export const PUBLIC_KEY = 'isPublic';

/**
 * Exime a un endpoint del AdminGuard.
 *
 * El guard deja pasar toda lectura y exige token en toda escritura, asi que en
 * la practica esto solo hace falta en el login: es un POST que, por definicion,
 * no puede venir autenticado.
 */
export const Public = () => SetMetadata(PUBLIC_KEY, true);
