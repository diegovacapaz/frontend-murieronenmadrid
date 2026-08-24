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

  /**
   * Los tres recortes se testean por separado a propósito: son tres columnas
   * distintas con tres topes distintos, y `strict: true` NO hace cumplir
   * `maxLength` —el subconjunto de structured outputs deja afuera las
   * restricciones de string—. Sin estos tests, borrar el recorte de `copete`
   * pasa la suite y explota contra el VARCHAR(240) en producción.
   */
  it('recorta un copete más largo que la columna', () => {
    const r = validarEdicion(
      { notas: [nota({ seccion: 'PORTADA', copete: 'x'.repeat(600) })] },
      VALIDOS,
    );
    if (r.ok) expect(r.notas[0].copete.length).toBeLessThanOrEqual(240);
  });

  it('recorta un cuerpo más largo que la columna', () => {
    const r = validarEdicion(
      { notas: [nota({ seccion: 'PORTADA', cuerpo: 'x'.repeat(20000) })] },
      VALIDOS,
    );
    if (r.ok) expect(r.notas[0].cuerpo.length).toBeLessThanOrEqual(16000);
  });

  it('descarta la mención con un rol que no existe', () => {
    const r = validarEdicion(
      {
        notas: [
          nota({
            seccion: 'PORTADA',
            jugadores: [
              { playerId: 7, rol: 'ARQUERO' },
              { playerId: 12, rol: 'VILLANO' },
            ],
          }),
        ],
      },
      VALIDOS,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.notas[0].jugadores).toHaveLength(1);
      expect(r.notas[0].jugadores[0].playerId).toBe(12);
    }
  });

  /**
   * El mismo playerId dos veces revienta el `PRIMARY KEY (articleId, playerId)`
   * de NewsletterArticlePlayers con un ER_DUP_ENTRY, y eso no se lleva puesta
   * la nota: se lleva puesta la edición entera. Gana el rol de más peso, porque
   * el rol decide qué foto ilustra la nota.
   */
  it('unifica al jugador nombrado dos veces y se queda con el rol más fuerte', () => {
    const r = validarEdicion(
      {
        notas: [
          nota({
            seccion: 'PORTADA',
            jugadores: [
              { playerId: 7, rol: 'MENCION' },
              { playerId: 7, rol: 'HEROE' },
              { playerId: 12, rol: 'VILLANO' },
              { playerId: 12, rol: 'MENCION' },
            ],
          }),
        ],
      },
      VALIDOS,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.notas[0].jugadores).toEqual([
        { playerId: 7, rol: 'H' },
        { playerId: 12, rol: 'V' },
      ]);
    }
  });

  /**
   * Una nota sin titular o sin cuerpo no es una nota: es una fila con dos
   * columnas NOT NULL en blanco. Se descarta la nota, no la edición — salvo que
   * la que se cayó fuera la portada, y entonces la edición no se publica, que
   * es lo correcto.
   */
  it('descarta la nota sin titular o sin cuerpo, y con ella se puede caer la edición', () => {
    const conPortada = validarEdicion(
      {
        notas: [
          nota({ seccion: 'PORTADA' }),
          nota({ seccion: 'BREVES', titular: '   ' }),
          nota({ seccion: 'BREVES', cuerpo: '' }),
        ],
      },
      VALIDOS,
    );
    expect(conPortada.ok).toBe(true);
    if (conPortada.ok) expect(conPortada.notas).toHaveLength(1);

    const sinPortada = validarEdicion(
      { notas: [nota({ seccion: 'PORTADA', cuerpo: '' })] },
      VALIDOS,
    );
    expect(sinPortada.ok).toBe(false);
  });
});
