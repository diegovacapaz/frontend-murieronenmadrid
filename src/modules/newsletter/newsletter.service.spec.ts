import { describe, expect, it } from 'vitest';
import { hayNovedades } from './newsletter.service';

describe('hayNovedades', () => {
  it('sin ediciones previas, cualquier partido es novedad', () => {
    expect(hayNovedades(314, null)).toBe(true);
  });

  it('sin ediciones previas y sin partidos, no hay nada que contar', () => {
    expect(hayNovedades(null, null)).toBe(false);
  });

  it('con el puntero al día, no hay novedades', () => {
    expect(hayNovedades(314, 314)).toBe(false);
  });

  it('con un partido nuevo, hay novedades', () => {
    expect(hayNovedades(315, 314)).toBe(true);
  });

  it('si se borró el último partido, no hay novedades', () => {
    // El puntero quedó adelante del máximo. No es un caso de error: alguien
    // borró un partido ya contado. No hay nada nuevo que decir.
    expect(hayNovedades(313, 314)).toBe(false);
  });
});
