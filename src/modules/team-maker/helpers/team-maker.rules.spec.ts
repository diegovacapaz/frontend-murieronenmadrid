import { describe, expect, it } from 'vitest';
import type { PickRef, Seat, TeamMakerState } from '../team-maker.types';
import {
  buildPickOrder,
  decideFirstSeat,
  ReactionLimiter,
  resolveColors,
  sanitizeNick,
  sanitizeSay,
  validatePick,
} from './team-maker.rules';

describe('buildPickOrder', () => {
  it('12 jugadores: 1, 2, 2, 2, 2, 1', () => {
    expect(buildPickOrder(12, 0)).toEqual([0, 1, 1, 0, 0, 1, 1, 0, 0, 1]);
  });

  it('4 jugadores: uno cada uno, empezando por el que elige primero', () => {
    expect(buildPickOrder(4, 1)).toEqual([1, 0]);
  });

  it('6 jugadores', () => {
    expect(buildPickOrder(6, 0)).toEqual([0, 1, 1, 0]);
  });

  it('cada lugar elige la misma cantidad para todo total par de 4 a 20', () => {
    for (let n = 4; n <= 20; n += 2) {
      for (const first of [0, 1] as Seat[]) {
        const order = buildPickOrder(n, first);
        expect(order).toHaveLength(n - 2);
        expect(order.filter((s) => s === 0)).toHaveLength((n - 2) / 2);
        expect(order[0]).toBe(first);
      }
    }
  });
});

describe('decideFirstSeat', () => {
  it('elige primero el que esta mas abajo en la tabla', () => {
    expect(decideFirstSeat([2, 5], () => 0.9)).toEqual({ firstSeat: 1, byDraw: false });
    expect(decideFirstSeat([7, 1], () => 0.9)).toEqual({ firstSeat: 0, byDraw: false });
  });

  it('draws when positions are null or equal', () => {
    expect(decideFirstSeat([null, 3], () => 0.1)).toEqual({ firstSeat: 0, byDraw: true });
    expect(decideFirstSeat([4, 4], () => 0.9)).toEqual({ firstSeat: 1, byDraw: true });
    expect(decideFirstSeat([null, null], () => 0.6)).toEqual({ firstSeat: 1, byDraw: true });
  });
});

const ref = (id: number): PickRef => ({ kind: 'P', id });

function stateAt(turn: number, overrides: Partial<TeamMakerState> = {}): TeamMakerState {
  const seat = { playerId: 1, name: 'Juan', photo: null, connected: true, released: false, voted: false };
  return {
    makerId: 1,
    matchId: 1,
    tournamentId: 1,
    isDerby: false,
    status: 'K',
    seats: [seat, { ...seat, playerId: 2, name: 'Diego' }],
    candidates: [],
    roster: [],
    firstSeat: 0,
    firstByDraw: false,
    order: [0, 1, 1, 0],
    turn,
    pool: [10, 11, 12, 13].map((id) => ({ ref: ref(id), name: `J${id}`, photo: null })),
    picks: [],
    colors: null,
    coinWinner: null,
    viewers: 0,
    paused: false,
    ...overrides,
  };
}

describe('validatePick', () => {
  it('acepta al lugar en turno con el turno esperado', () => {
    expect(validatePick(stateAt(1), 1, 1, ref(10))).toBeNull();
  });

  it('rejects a pick for a turn already played', () => {
    expect(validatePick(stateAt(3), 0, 2, ref(10))).toBe('WRONG_TURN');
  });

  it('rechaza al lugar que no esta en turno', () => {
    expect(validatePick(stateAt(0), 1, 0, ref(10))).toBe('NOT_YOUR_TURN');
  });

  it('rechaza con el armado en pausa', () => {
    expect(validatePick(stateAt(0, { paused: true }), 0, 0, ref(10))).toBe('PAUSED');
  });

  it('rechaza fuera de la etapa de eleccion', () => {
    expect(validatePick(stateAt(0, { status: 'V' }), 0, 0, ref(10))).toBe('NOT_PICKING');
  });

  it('rechaza a alguien que no esta disponible', () => {
    expect(validatePick(stateAt(0), 0, 0, ref(99))).toBe('NOT_IN_POOL');
    expect(validatePick(stateAt(0), 0, 0, { kind: 'G', id: 10 })).toBe('NOT_IN_POOL');
  });
});

describe('resolveColors', () => {
  it('votos distintos: cada uno se queda con el suyo', () => {
    expect(resolveColors(['D', 'L'], false, () => 0)).toEqual({ colors: ['D', 'L'], coinWinner: null });
    expect(resolveColors(['L', 'D'], false, () => 0)).toEqual({ colors: ['L', 'D'], coinWinner: null });
  });

  it('votos iguales: la moneda decide y el otro se queda con el color restante', () => {
    expect(resolveColors(['S', 'S'], true, () => 0.7)).toEqual({ colors: ['R', 'S'], coinWinner: 1 });
    expect(resolveColors(['D', 'D'], false, () => 0.2)).toEqual({ colors: ['D', 'L'], coinWinner: 0 });
  });

  it('un color que no es de este tipo de partido es invalido', () => {
    expect(() => resolveColors(['D', 'S'], false, () => 0)).toThrow('INVALID_COLOR');
    expect(() => resolveColors(['D', 'L'], true, () => 0)).toThrow('INVALID_COLOR');
  });
});

describe('ReactionLimiter', () => {
  it('un emote cada 2 segundos por socket', () => {
    let now = 0;
    const limiter = new ReactionLimiter(() => now);
    expect(limiter.tryEmote('a')).toBe(true);
    now = 1999;
    expect(limiter.tryEmote('a')).toBe(false);
    expect(limiter.tryEmote('b')).toBe(true);
    now = 2000;
    expect(limiter.tryEmote('a')).toBe(true);
  });

  it('un mensaje cada 3 segundos, independiente de los emotes', () => {
    let now = 0;
    const limiter = new ReactionLimiter(() => now);
    expect(limiter.tryEmote('a')).toBe(true);
    expect(limiter.trySay('a')).toBe(true);
    now = 2999;
    expect(limiter.trySay('a')).toBe(false);
    now = 3000;
    expect(limiter.trySay('a')).toBe(true);
  });

  it('forget libera al socket', () => {
    const limiter = new ReactionLimiter(() => 0);
    limiter.tryEmote('a');
    limiter.forget('a');
    expect(limiter.tryEmote('a')).toBe(true);
  });
});

describe('sanitizeSay y sanitizeNick', () => {
  it('recorta, saca caracteres de control y corta a 40', () => {
    expect(sanitizeSay('  hola\u0007 ')).toBe('hola');
    expect(sanitizeSay('x'.repeat(50))?.length).toBe(40);
    expect(sanitizeSay('   ')).toBeNull();
    expect(sanitizeSay(42)).toBeNull();
  });

  it('el apodo va hasta 16 y vacio es Anónimo', () => {
    expect(sanitizeNick('   ')).toBe('Anónimo');
    expect(sanitizeNick(undefined)).toBe('Anónimo');
    expect(sanitizeNick('Nacho el Grande del Oeste')).toBe('Nacho el Grande');
  });

  it('un apodo no puede llevar la estrella de los capitanes', () => {
    expect(sanitizeNick('★ Diego')).toBe('Diego');
    expect(sanitizeNick('★')).toBe('Anónimo');
  });
});
