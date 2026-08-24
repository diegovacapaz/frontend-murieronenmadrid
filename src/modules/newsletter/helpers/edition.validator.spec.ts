import { describe, expect, it } from 'vitest';
import { validarEdicion } from './edition.validator';

const VALIDOS = new Set([7, 12]);

function nota(overrides: Record<string, unknown> = {}) {
  return {
    seccion: 'BREVES',
    titular: 'Un titular',
    copete: 'Un copete',
    cuerpo: 'Un cuerpo.',
    jugadores: [],
    ...overrides,
  };
}

describe('validarEdicion', () => {
  it('acepta una edición con exactamente una portada', () => {
    const r = validarEdicion(
      { notas: [nota({ seccion: 'PORTADA' }), nota()] },
      VALIDOS,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.notas).toHaveLength(2);
  });

  it('rechaza una edición sin portada', () => {
    const r = validarEdicion({ notas: [nota()] }, VALIDOS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toContain('portada');
  });

  it('rechaza una edición con dos portadas', () => {
    const r = validarEdicion(
      { notas: [nota({ seccion: 'PORTADA' }), nota({ seccion: 'PORTADA' })] },
      VALIDOS,
    );
    expect(r.ok).toBe(false);
  });

  it('descarta la mención a un jugador que no existe, pero conserva la nota', () => {
    const r = validarEdicion(
      {
        notas: [
          nota({
            seccion: 'PORTADA',
            jugadores: [
              { playerId: 7, rol: 'HEROE' },
              { playerId: 9999, rol: 'MENCION' },
            ],
          }),
        ],
      },
      VALIDOS,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.notas[0].jugadores).toHaveLength(1);
      expect(r.notas[0].jugadores[0].playerId).toBe(7);
    }
  });

  it('traduce las secciones al CHAR(1) de la base', () => {
    const r = validarEdicion({ notas: [nota({ seccion: 'PORTADA' })] }, VALIDOS);
    if (r.ok) expect(r.notas[0].seccion).toBe('P');
  });

  it('la portada queda primera aunque el modelo la haya mandado última', () => {
    const r = validarEdicion(
      {
        notas: [
          nota({ seccion: 'BREVES', titular: 'Breve' }),
          nota({ seccion: 'PORTADA', titular: 'Portada' }),
        ],
      },
      VALIDOS,
    );
    if (r.ok) expect(r.notas[0].titular).toBe('Portada');
  });

  it('rechaza un input que no tiene la forma esperada', () => {
    expect(validarEdicion(null, VALIDOS).ok).toBe(false);
    expect(validarEdicion({}, VALIDOS).ok).toBe(false);
    expect(validarEdicion({ notas: [] }, VALIDOS).ok).toBe(false);
    expect(validarEdicion({ notas: 'no' }, VALIDOS).ok).toBe(false);
  });

  it('recorta un titular más largo que la columna', () => {
    const r = validarEdicion(
      { notas: [nota({ seccion: 'PORTADA', titular: 'x'.repeat(200) })] },
      VALIDOS,
    );
    if (r.ok) expect(r.notas[0].titular.length).toBeLessThanOrEqual(120);
  });
});
