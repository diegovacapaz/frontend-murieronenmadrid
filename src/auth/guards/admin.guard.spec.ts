import { Reflector } from '@nestjs/core';
import { UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import { AdminGuard } from './admin.guard';
import { ADMIN_ONLY_KEY } from '../decorators/admin-only.decorator';
import { PUBLIC_KEY } from '../decorators/public.decorator';
import type { AuthService } from '../auth.service';

/**
 * Contexto HTTP mínimo. El guard solo mira `getType()`, el handler, la clase,
 * el método y el header de autorización.
 */
function contextoHttp(method: string, authorization?: string): ExecutionContext {
  return {
    getType: () => 'http',
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
    switchToHttp: () => ({
      getRequest: () => ({ method, headers: { authorization } }),
    }),
  } as unknown as ExecutionContext;
}

/** Reflector que responde `valor` para `clave` y undefined para el resto. */
function reflectorCon(clave: string, valor: unknown): Reflector {
  return {
    getAllAndOverride: (key: string) => (key === clave ? valor : undefined),
  } as unknown as Reflector;
}

const authServiceOk = { verifyToken: vi.fn() } as unknown as AuthService;

describe('AdminGuard', () => {
  it('deja pasar un GET normal sin token', () => {
    const guard = new AdminGuard(reflectorCon('nada', undefined), authServiceOk);
    expect(guard.canActivate(contextoHttp('GET'))).toBe(true);
  });

  it('rechaza un GET marcado con @AdminOnly si no hay token', () => {
    const guard = new AdminGuard(reflectorCon(ADMIN_ONLY_KEY, true), authServiceOk);
    expect(() => guard.canActivate(contextoHttp('GET'))).toThrow(UnauthorizedException);
  });

  it('deja pasar un GET marcado con @AdminOnly si el token es válido', () => {
    // Mock propio: si alguien borra el `this.authService.verifyToken(token)`
    // del guard, este assert lo detecta aunque el resultado siga siendo `true`.
    const verifyToken = vi.fn();
    const authService = { verifyToken } as unknown as AuthService;
    const guard = new AdminGuard(reflectorCon(ADMIN_ONLY_KEY, true), authService);
    expect(guard.canActivate(contextoHttp('GET', 'Bearer un-token'))).toBe(true);
    expect(verifyToken).toHaveBeenCalledWith('un-token');
  });

  it('sigue exigiendo token en un POST', () => {
    const guard = new AdminGuard(reflectorCon('nada', undefined), authServiceOk);
    expect(() => guard.canActivate(contextoHttp('POST'))).toThrow(UnauthorizedException);
  });

  it('@Public() gana sobre todo lo demás', () => {
    const guard = new AdminGuard(reflectorCon(PUBLIC_KEY, true), authServiceOk);
    expect(guard.canActivate(contextoHttp('DELETE'))).toBe(true);
  });
});
