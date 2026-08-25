import { describe, expect, it } from 'vitest';
import { MAX_NOTAS } from '../newsletter.tool';
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
  /**
   * `maxItems` no está en el schema porque la API rechaza la herramienta entera
   * con un 400 si lo ve (probado contra la API real, ver newsletter.tool.ts).
   * O sea que este recorte es la ÚNICA defensa que queda para los dos topes.
   *
   * El orden importa y por eso la portada va última en el input: si el recorte
   * corriera antes de subirla al frente, una portada más allá del puesto diez
   * se perdería y la edición se rechazaría entera.
   */
  it('recorta al tope de notas y la portada sobrevive aunque viniera más allá', () => {
    const demasiadas = [
      ...Array.from({ length: MAX_NOTAS + 9 }, (_, i) =>
        nota({ seccion: 'BREVES', titular: `Breve ${i}` }),
      ),
      nota({ seccion: 'PORTADA', titular: 'Portada' }),
    ];

    const r = validarEdicion({ notas: demasiadas }, VALIDOS);
    expect(r.ok).toBe(true);
    if (r.ok) {
      // Contra la constante, no contra un número escrito acá: cuando MAX_NOTAS
      // subió de 10 a 16, este test falló por el motivo equivocado.
      expect(r.notas).toHaveLength(MAX_NOTAS);
      expect(r.notas[0].titular).toBe('Portada');
      expect(r.notas[1].titular).toBe('Breve 0');
    }
  });

  it('recorta a ocho jugadores por nota, después de deduplicar', () => {
    const doce = Array.from({ length: 12 }, () => ({
      playerId: 7,
      rol: 'MENCION',
    }));

    const r = validarEdicion(
      {
        notas: [
          nota({ seccion: 'PORTADA', jugadores: doce }),
          nota({
            seccion: 'BREVES',
            // Doce jugadores distintos, todos válidos: se conservan los ocho
            // primeros. VALIDOS solo tiene dos ids, así que el set se amplía.
            jugadores: Array.from({ length: 12 }, (_, i) => ({
              playerId: i + 1,
              rol: 'MENCION',
            })),
          }),
        ],
      },
      new Set(Array.from({ length: 12 }, (_, i) => i + 1)),
    );

    expect(r.ok).toBe(true);
    if (r.ok) {
      // Doce veces el mismo tipo son UN jugador, no ocho: primero dedup.
      expect(r.notas[0].jugadores).toHaveLength(1);
      expect(r.notas[1].jugadores).toHaveLength(8);
      expect(r.notas[1].jugadores[7].playerId).toBe(8);
    }
  });

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
