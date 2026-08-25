import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AppErrorCode } from '../../common/constants/error-codes.constants';
import { PUBLIC_KEY } from '../decorators/public.decorator';
import { ADMIN_ONLY_KEY } from '../decorators/admin-only.decorator';
import { AuthService } from '../auth.service';

/** Metodos que no modifican nada: cualquiera los puede ejecutar, sin token. */
const READ_ONLY_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Guard global. Aplica la unica regla de acceso del sistema:
 *
 *   leer es libre; escribir exige el token que devuelve POST /auth/login.
 *
 * Se decide por METODO HTTP y no por decorador en cada endpoint. Es deliberado:
 * con un decorador, cualquier endpoint nuevo que alguien olvide anotar queda
 * abierto a escritura sin que nadie lo note. Con esta regla, un POST nuevo nace
 * protegido y hay que pedir permiso explicito (@Public) para abrirlo.
 *
 * Dos excepciones explicitas, en este orden de prioridad:
 *   @Public()     abre un endpoint que la regla cerraria
 *   @AdminOnly()  cierra una LECTURA que la regla abriria
 *
 * La segunda existe por el lore de los jugadores: es un GET que el grupo no
 * tiene que poder leer.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authService: AuthService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    // Los gateways de websocket no pasan por aca (el guard es HTTP-only), y los
    // sockets de este sistema son de solo lectura: emiten, no reciben comandos.
    if (context.getType() !== 'http') {
      return true;
    }

    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();

    const isAdminOnly = this.reflector.getAllAndOverride<boolean>(ADMIN_ONLY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // El orden importa: la marca gana sobre la regla del metodo. Un GET marcado
    // como @AdminOnly cae al chequeo de token igual que un POST.
    if (!isAdminOnly && READ_ONLY_METHODS.has(request.method)) {
      return true;
    }

    const token = this.extractToken(request);

    if (!token) {
      throw new UnauthorizedException({
        message: 'Admin token is required for write operations',
        errorCode: AppErrorCode.AUTH_TOKEN_MISSING,
      });
    }

    // verifyToken lanza AUTH_TOKEN_EXPIRED o AUTH_TOKEN_INVALID segun el caso:
    // el frontend los distingue para decidir si manda a re-loguear o solo avisa.
    this.authService.verifyToken(token);

    return true;
  }

  /**
   * Acepta el token por `Authorization: Bearer <token>`. No se usan cookies:
   * el frontend es una SPA en otro origen y guardar el token en memoria (se
   * pierde al recargar) es justamente lo que hacia el sistema original.
   */
  private extractToken(request: Request): string | null {
    const header = request.headers.authorization;
    if (!header) return null;

    const [scheme, value] = header.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !value) return null;

    return value.trim();
  }
}
