import { describe, expect, it } from 'vitest';
import { validarTop3 } from './top3.validator';

const JUGARON = new Set([10, 20, 30, 40]);

const puesto = (playerId: number, razon = 'Una razón con un dato verificado.') => ({
  playerId,
  razon,
});

function problemasDe(input: unknown): string[] {
  const r = validarTop3(input, JUGARON);
  if (r.ok) throw new Error('se esperaba un rechazo y salió ok');
  return r.problemas;
}

describe('validarTop3', () => {
  it('tres válidos: ok, con las razones sin espacios de los costados', () => {
    const r = validarTop3(
      [puesto(10, '  Primero.  '), puesto(20, 'Segundo.'), puesto(30, 'Tercero.')],
      JUGARON,
    );

    expect(r).toEqual({
      ok: true,
      entradas: [
        { playerId: 10, reason: 'Primero.' },
        { playerId: 20, reason: 'Segundo.' },
        { playerId: 30, reason: 'Tercero.' },
      ],
    });
  });

  it.each([
    ['dos', [puesto(10), puesto(20)]],
    ['cuatro', [puesto(10), puesto(20), puesto(30), puesto(40)]],
  ])('con %s puestos dice que hacen falta tres', (_n, top) => {
    expect(problemasDe(top).join(' ')).toMatch(/tres/i);
  });

  it('un jugador repetido se informa', () => {
    expect(problemasDe([puesto(10), puesto(10), puesto(30)]).join(' ')).toMatch(/repet/i);
  });

  it('un jugador que no jugó el torneo se informa con su id', () => {
    expect(problemasDe([puesto(10), puesto(20), puesto(9999)]).join(' ')).toContain('9999');
  });

  it('una razón vacía o de puros espacios se informa', () => {
    expect(problemasDe([puesto(10), puesto(20), puesto(30, '   ')]).join(' ')).toMatch(/frase|raz/i);
  });

  it('una razón de 301 caracteres se rechaza (y dice el largo); una de 300 pasa', () => {
    expect(problemasDe([puesto(10), puesto(20), puesto(30, 'x'.repeat(301))]).join(' ')).toContain(
      '301',
    );

    const r = validarTop3([puesto(10), puesto(20), puesto(30, 'x'.repeat(300))], JUGARON);
    expect(r.ok).toBe(true);
  });

  it.each([
    ['algo que no es un array', 'hola'],
    ['null', null],
    ['un elemento que es null', [puesto(10), null, puesto(30)]],
    ['un elemento sin forma', [puesto(10), { foo: 1 }, puesto(30)]],
  ])('%s: rechaza sin lanzar', (_caso, input) => {
    expect(() => validarTop3(input, JUGARON)).not.toThrow();
    expect(validarTop3(input, JUGARON).ok).toBe(false);
  });

  it('informa TODOS los problemas juntos, no sólo el primero', () => {
    const problemas = problemasDe([puesto(10), puesto(10, ''), puesto(9999)]);

    expect(problemas.length).toBeGreaterThanOrEqual(3);
  });
});
