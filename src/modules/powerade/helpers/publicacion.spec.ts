import { describe, expect, it } from 'vitest';
import type { BaseDelBorrador } from '../entities/powerade.entity';
import { decidirPublicacion } from './publicacion';

const version = (parcial: Partial<NonNullable<BaseDelBorrador>> = {}): BaseDelBorrador => ({
  rankingId: 5,
  version: 3,
  lastMatchId: 100,
  revision: 1,
  ...parcial,
});

describe('decidirPublicacion', () => {
  it('sin base y sin vigente: se inserta la primera versión', () => {
    expect(decidirPublicacion(null, 100, null)).toBe('insertar');
  });

  it('sin base pero con una vigente: otra conversación publicó primero', () => {
    expect(decidirPublicacion(null, 100, version())).toBe('conflicto');
  });

  it('con base pero sin vigente (se borró): conflicto', () => {
    expect(decidirPublicacion(version(), 100, null)).toBe('conflicto');
  });

  it('otro rankingId: conflicto (una conversación vieja no pisa una versión nueva)', () => {
    expect(decidirPublicacion(version({ rankingId: 5 }), 200, version({ rankingId: 6 }))).toBe(
      'conflicto',
    );
  });

  it('el mismo rankingId con otra revisión: conflicto (dos reemplazos sobre la misma base)', () => {
    expect(decidirPublicacion(version({ revision: 1 }), 100, version({ revision: 2 }))).toBe(
      'conflicto',
    );
  });

  it('base igual a la vigente y partidos nuevos: se inserta una versión nueva', () => {
    expect(decidirPublicacion(version(), 101, version())).toBe('insertar');
  });

  it('base igual a la vigente y nada nuevo: se reemplaza', () => {
    expect(decidirPublicacion(version(), 100, version())).toBe('reemplazar');
  });

  it('un lastMatchId MENOR (se borró un partido) también reemplaza: no bloquea la publicación', () => {
    expect(decidirPublicacion(version(), 90, version())).toBe('reemplazar');
  });
});
