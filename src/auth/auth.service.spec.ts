import { JwtService } from '@nestjs/jwt';
import { describe, expect, it } from 'vitest';
import type { GlobalsService } from '../globals/globals.service';
import { AuthService } from './auth.service';

const jwt = new JwtService({ secret: 'secreto-de-prueba-largo' });
const globals = { get: () => '1h' } as unknown as GlobalsService;
const auth = new AuthService(jwt, globals);

describe('AuthService.isAdminAuthorization', () => {
  it('sin header no es admin', () => {
    expect(auth.isAdminAuthorization(undefined)).toBe(false);
  });

  it('un esquema que no es Bearer no es admin', () => {
    expect(auth.isAdminAuthorization('Basic x')).toBe(false);
  });

  it('un token mal firmado no es admin', () => {
    const otro = new JwtService({ secret: 'otro-secreto-cualquiera' }).sign({ scope: 'admin' });
    expect(auth.isAdminAuthorization(`Bearer ${otro}`)).toBe(false);
  });

  it('un Bearer firmado con el secreto es admin', () => {
    const token = jwt.sign({ scope: 'admin' });
    expect(auth.isAdminAuthorization(`Bearer ${token}`)).toBe(true);
  });
});
