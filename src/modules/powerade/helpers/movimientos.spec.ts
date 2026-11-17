import { describe, expect, it } from 'vitest';
import { calcularMovimientos } from './movimientos';

const puesto = (position: number, playerId: number) => ({ position, playerId });

describe('calcularMovimientos', () => {
  it('sin versión anterior, ninguno tiene movimiento', () => {
    expect(calcularMovimientos([puesto(1, 10), puesto(2, 20), puesto(3, 30)], null)).toEqual([
      null,
      null,
      null,
    ]);
  });

  it('el mismo orden es "igual" para los tres', () => {
    const top = [puesto(1, 10), puesto(2, 20), puesto(3, 30)];

    expect(calcularMovimientos(top, top)).toEqual([
      { tipo: 'igual', lugares: 0 },
      { tipo: 'igual', lugares: 0 },
      { tipo: 'igual', lugares: 0 },
    ]);
  });

  it('quien pasa del puesto 3 al 1 sube dos lugares y quien baja del 1 al 2 baja uno', () => {
    const anterior = [puesto(1, 10), puesto(2, 20), puesto(3, 30)];
    const actual = [puesto(1, 30), puesto(2, 10), puesto(3, 20)];

    expect(calcularMovimientos(actual, anterior)).toEqual([
      { tipo: 'sube', lugares: 2 },
      { tipo: 'baja', lugares: 1 },
      { tipo: 'baja', lugares: 1 },
    ]);
  });

  it('quien no estaba en el top 3 anterior "entra"', () => {
    const anterior = [puesto(1, 10), puesto(2, 20), puesto(3, 30)];
    const actual = [puesto(1, 10), puesto(2, 20), puesto(3, 99)];

    expect(calcularMovimientos(actual, anterior)[2]).toEqual({ tipo: 'entra', lugares: 0 });
  });

  it('devuelve un elemento por entrada y en el mismo orden que `actual`', () => {
    const anterior = [puesto(1, 10), puesto(2, 20), puesto(3, 30)];
    const actual = [puesto(1, 99), puesto(2, 20), puesto(3, 10)];

    expect(calcularMovimientos(actual, anterior)).toEqual([
      { tipo: 'entra', lugares: 0 },
      { tipo: 'igual', lugares: 0 },
      { tipo: 'baja', lugares: 2 },
    ]);
  });
});
