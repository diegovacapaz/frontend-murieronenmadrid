import { Reflector } from '@nestjs/core';
import { UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import { AdminGuard } from './admin.guard';
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
    const guard = new AdminGuard(reflectorCon('adminOnly', true), authServiceOk);
    expect(() => guard.canActivate(contextoHttp('GET'))).toThrow(UnauthorizedException);
  });

  it('deja pasar un GET marcado con @AdminOnly si el token es válido', () => {
    const guard = new AdminGuard(reflectorCon('adminOnly', true), authServiceOk);
    expect(guard.canActivate(contextoHttp('GET', 'Bearer un-token'))).toBe(true);
  });

  it('sigue exigiendo token en un POST', () => {
    const guard = new AdminGuard(reflectorCon('nada', undefined), authServiceOk);
    expect(() => guard.canActivate(contextoHttp('POST'))).toThrow(UnauthorizedException);
  });

  it('@Public() gana sobre todo lo demás', () => {
    const guard = new AdminGuard(reflectorCon('isPublic', true), authServiceOk);
    expect(guard.canActivate(contextoHttp('DELETE'))).toBe(true);
  });
});
