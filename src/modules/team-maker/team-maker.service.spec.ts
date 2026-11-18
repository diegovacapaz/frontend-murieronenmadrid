/* eslint-disable @typescript-eslint/require-await -- el repo falso imita la interfaz async sin I/O real */
import { beforeEach, describe, expect, it } from 'vitest';
import type {
  ITeamMakerRepository,
  TeamMakerRecord,
} from './interfaces/team-maker.repository.interface';
import { TeamMakerService, type Clock } from './team-maker.service';
import type { PickRef, Seat } from './team-maker.types';

/** Reloj falso: los timers corren solo cuando el test avanza el tiempo. */
class FakeClock implements Clock {
  t = 0;
  private timers: Array<{ at: number; fn: () => void; id: number }> = [];
  private seq = 0;
  now = () => this.t;
  setTimeout = (fn: () => void, ms: number) => {
    const id = ++this.seq;
    this.timers.push({ at: this.t + ms, fn, id });
    return id;
  };
  clearTimeout = (h: unknown) => {
    this.timers = this.timers.filter((x) => x.id !== h);
  };
  advance(ms: number) {
    this.t += ms;
    const due = this.timers.filter((x) => x.at <= this.t);
    this.timers = this.timers.filter((x) => x.at > this.t);
    due.forEach((x) => x.fn());
  }
}

const P = (id: number): PickRef => ({ kind: 'P', id });
const G = (id: number): PickRef => ({ kind: 'G', id });

/** Partido de 6: jugadores 1..5 y un random (guest 9). */
function baseRecord(): TeamMakerRecord {
  return {
    makerId: 7,
    matchId: 70,
    tournamentId: 5,
    isDerby: false,
    status: 'W',
    captainCode: 'CODE',
    firstSeat: null,
    firstByDraw: false,
    coinWinner: null,
    seats: [
      { playerId: null, name: null, photo: null, tokenHash: null, vote: null },
      { playerId: null, name: null, photo: null, tokenHash: null, vote: null },
    ],
    picks: [],
    roster: [
      ...[1, 2, 3, 4, 5].map((id) => ({ ref: P(id), name: `J${id}`, photo: null })),
      { ref: G(9), name: 'Hernán', photo: null },
    ],
  };
}

class FakeRepo implements ITeamMakerRepository {
  record: TeamMakerRecord | null = baseRecord();
  positions: [number | null, number | null] = [null, null];
  calls: string[] = [];
  finished: { colors: [string, string]; coinWinner: Seat | null } | null = null;

  async create() {
    return { makerId: 7, captainCode: 'CODE' };
  }
  async findByMatch() {
    return this.record ? structuredClone(this.record) : null;
  }
  async claimSeat(_m: number, seat: Seat, playerId: number, tokenHash: string) {
    this.calls.push(`claim:${seat}:${playerId}`);
    const r = this.record!;
    const other = r.seats[seat === 0 ? 1 : 0];
    const cur = r.seats[seat];
    if ((cur.playerId !== null && cur.playerId !== playerId) || other.playerId === playerId) {
      throw new Error('46601');
    }
    r.seats[seat] = { ...cur, playerId, tokenHash, name: `J${playerId}` };
  }
  async captainPositions() {
    return this.positions;
  }
  async startPicking(_m: number, firstSeat: Seat, byDraw: boolean) {
    Object.assign(this.record!, { status: 'K', firstSeat, firstByDraw: byDraw });
  }
  async addPick(_m: number, turn: number, seat: Seat, ref: PickRef, isLast: boolean) {
    if (this.record!.picks.some((p) => p.turn === turn)) throw new Error('1062');
    this.record!.picks.push({ turn, seat, ref });
    if (isLast) this.record!.status = 'V';
  }
  async setVote(_m: number, seat: Seat, vote: string) {
    this.record!.seats[seat].vote = vote;
  }
  async finish(_m: number, colors: [string, string], coinWinner: Seat | null) {
    this.finished = { colors, coinWinner };
    this.record!.status = 'F';
  }
  async cancel() {
    this.record!.status = 'C';
  }
  async restart(_m: number, code: string) {
    const fresh = baseRecord();
    this.record = { ...fresh, captainCode: code };
  }
}

let repo: FakeRepo;
let clock: FakeClock;
let events: Array<[string, unknown]>;
let room: Array<[string, unknown]>;
let kicked: string[];
let service: TeamMakerService;

beforeEach(() => {
  repo = new FakeRepo();
  clock = new FakeClock();
  events = [];
  room = [];
  kicked = [];
  service = new TeamMakerService(repo, (e, p) => events.push([e, p]), clock, () => 0.3);
  service.attachRoom(
    (_matchId, event, payload) => room.push([event, payload]),
    (socketId) => kicked.push(socketId),
  );
});

async function twoCaptains() {
  await service.join('a', 70, { code: 'CODE' });
  await service.join('b', 70, { code: 'CODE' });
  const a = await service.claim('a', 1);
  const b = await service.claim('b', 2);
  return { a, b };
}

describe('TeamMakerService', () => {
  it('rebuilds state from repository on first join', async () => {
    Object.assign(repo.record!, {
      status: 'K',
      firstSeat: 0,
      seats: [
        { playerId: 1, name: 'J1', photo: null, tokenHash: 'x', vote: null },
        { playerId: 2, name: 'J2', photo: null, tokenHash: 'y', vote: null },
      ],
      picks: [
        { turn: 0, seat: 0, ref: P(3) },
        { turn: 1, seat: 1, ref: P(4) },
      ],
    });

    const { state, seat } = await service.join('v', 70, {});

    expect(seat).toBeNull();
    expect(state.picks).toHaveLength(2);
    expect(state.turn).toBe(2);
    expect(state.order).toEqual([0, 1, 1, 0]);
    expect(state.pool.map((e) => e.ref)).toEqual([P(5), G(9)]);
    expect(state.roster).toHaveLength(6);
    expect(state.tournamentId).toBe(5);
    expect(state.paused).toBe(true);
  });

  it('claims both seats and starts picking with draw when no positions', async () => {
    await twoCaptains();
    const state = service.snapshot(70)!;
    expect(state.status).toBe('K');
    expect(state.firstByDraw).toBe(true);
    expect(state.firstSeat).toBe(0); // random 0.3 < 0.5
    expect(state.paused).toBe(false);
    expect(events.map(([e]) => e)).toContain('teammaker:updated');
  });

  it('elige primero el que esta mas abajo en la tabla', async () => {
    repo.positions = [1, 4];
    await twoCaptains();
    expect(service.snapshot(70)!.firstSeat).toBe(1);
    expect(service.snapshot(70)!.firstByDraw).toBe(false);
  });

  it('sin el codigo del link no se puede marcar capitan', async () => {
    await service.join('v', 70, {});
    await expect(service.claim('v', 1)).rejects.toMatchObject({ code: 'NOT_CAPTAIN_LINK' });
    await service.join('w', 70, { code: 'OTRO' });
    await expect(service.claim('w', 1)).rejects.toMatchObject({ code: 'NOT_CAPTAIN_LINK' });
  });

  it('reclaims seat with token within and after grace', async () => {
    const { b } = await twoCaptains();

    service.leave('b');
    expect(service.snapshot(70)!.paused).toBe(true);
    clock.advance(5000);
    const back = await service.join('b2', 70, { code: 'CODE', seatToken: b.seatToken });
    expect(back.seat).toBe(1);
    expect(back.state.paused).toBe(false);

    service.leave('b2');
    clock.advance(9000);
    expect(service.snapshot(70)!.seats[1].released).toBe(true);
    await service.join('c', 70, { code: 'CODE' });
    await expect(service.claim('c', 3)).rejects.toMatchObject({ code: 'SEAT_UNAVAILABLE' });
    const again = await service.claim('c', 2);
    expect(again.seat).toBe(1);
    expect(service.snapshot(70)!.paused).toBe(false);
  });

  it('durante la gracia nadie puede reclamar el lugar con el nombre', async () => {
    await twoCaptains();
    service.leave('b');
    clock.advance(2000);
    await service.join('c', 70, { code: 'CODE' });
    await expect(service.claim('c', 2)).rejects.toMatchObject({ code: 'SEAT_RECONNECTING' });
  });

  it('second socket with same token replaces the first', async () => {
    const { a } = await twoCaptains();
    const again = await service.join('a2', 70, { code: 'CODE', seatToken: a.seatToken });
    expect(again.seat).toBe(0);
    expect(kicked).toContain('a');
    await expect(service.pick('a', 0, P(3))).rejects.toMatchObject({ code: 'NOT_CAPTAIN' });
  });

  it('rejects pick out of turn and accepts in turn', async () => {
    await twoCaptains();
    await expect(service.pick('b', 0, P(3))).rejects.toMatchObject({ code: 'NOT_YOUR_TURN' });
    await service.pick('a', 0, P(3));
    await expect(service.pick('a', 0, P(4))).rejects.toMatchObject({ code: 'WRONG_TURN' });
    expect(service.snapshot(70)!.turn).toBe(1);
    expect(repo.record!.picks).toHaveLength(1);
  });

  it('dos elecciones al mismo tiempo: solo cuenta una', async () => {
    await twoCaptains();
    const results = await Promise.allSettled([service.pick('a', 0, P(3)), service.pick('a', 0, P(4))]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(repo.record!.picks).toHaveLength(1);
  });

  it('con un capitan caido no se elige', async () => {
    await twoCaptains();
    service.leave('b');
    await expect(service.pick('a', 0, P(3))).rejects.toMatchObject({ code: 'PAUSED' });
  });

  it('finishes after both votes and notifies', async () => {
    await twoCaptains();
    // orden con 6: A B B A
    await service.pick('a', 0, P(3));
    await service.pick('b', 1, P(4));
    await service.pick('b', 2, G(9));
    await service.pick('a', 3, P(5));
    expect(service.snapshot(70)!.status).toBe('V');

    await service.vote('a', 'D');
    expect(service.snapshot(70)!.seats[0].voted).toBe(true);
    expect(repo.finished).toBeNull();
    await service.vote('b', 'D');

    expect(repo.finished).toEqual({ colors: ['D', 'L'], coinWinner: 0 });
    const state = service.snapshot(70)!;
    expect(state.status).toBe('F');
    expect(state.colors).toEqual(['D', 'L']);
    expect(events.map(([e]) => e)).toEqual(expect.arrayContaining(['teammaker:finished', 'match:updated']));
  });

  it('un voto con un color de otro tipo de partido se rechaza', async () => {
    await twoCaptains();
    for (const [s, t, r] of [['a', 0, P(3)], ['b', 1, P(4)], ['b', 2, G(9)], ['a', 3, P(5)]] as const) {
      await service.pick(s, t, r);
    }
    await expect(service.vote('a', 'S')).rejects.toMatchObject({ code: 'INVALID_COLOR' });
  });

  it('captain cannot react; viewer limited to one emote per 4s', async () => {
    await twoCaptains();
    await expect(service.react('a', { emoteId: 'emote_king_cry' })).rejects.toMatchObject({
      code: 'CAPTAIN_CANNOT_REACT',
    });

    await service.join('v', 70, { nick: '  Nacho ' });
    await service.react('v', { emoteId: 'emote_king_cry' });
    await expect(service.react('v', { emoteId: 'emote_king_cry' })).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
    clock.advance(4000);
    await service.react('v', { emoteId: 'emote_goblin_grin' });

    const reactions = room.filter(([e]) => e === 'tm:reaction').map(([, p]) => p);
    expect(reactions).toHaveLength(2);
    expect(reactions[0]).toMatchObject({ nick: 'Nacho', emoteId: 'emote_king_cry' });
  });

  it('un mensaje se limpia y uno vacio se rechaza', async () => {
    await service.join('v', 70, {});
    await expect(service.react('v', { text: '   ' })).rejects.toMatchObject({ code: 'EMPTY' });
    await service.react('v', { text: 'x'.repeat(60) });
    const said = room.find(([e]) => e === 'tm:reaction')![1] as { text: string; nick: string };
    expect(said.text).toHaveLength(40);
    expect(said.nick).toBe('Anónimo');
  });

  it('cuenta los viewers conectados', async () => {
    await service.join('v1', 70, {});
    await service.join('v2', 70, {});
    expect(service.snapshot(70)!.viewers).toBe(2);
    service.leave('v1');
    expect(service.snapshot(70)!.viewers).toBe(1);
  });

  it('reiniciar libera los lugares y el link viejo deja de servir', async () => {
    await twoCaptains();
    const { captainCode } = await service.restart(70);
    const state = service.snapshot(70)!;
    expect(state.status).toBe('W');
    expect(state.seats.every((s) => s.playerId === null)).toBe(true);
    await expect(service.claim('a', 1)).rejects.toMatchObject({ code: 'NOT_CAPTAIN_LINK' });
    await service.join('a', 70, { code: captainCode });
    expect((await service.claim('a', 1)).seat).toBe(0);
  });

  it('el estado publico se puede leer sin entrar a la sala (no cuenta como viewer)', async () => {
    const state = await service.publicState(70);
    expect(state.status).toBe('W');
    expect(state.viewers).toBe(0);
    await service.join('v', 70, {});
    expect((await service.publicState(70)).viewers).toBe(1);
  });

  it('borrar el partido suelta el armado de memoria y lo muestra cancelado', async () => {
    await twoCaptains();
    service.leave('a'); // queda un timer de gracia pendiente
    room.length = 0;
    events.length = 0;
    repo.record = null; // la base lo borró en cascada

    service.discard(70);

    expect(service.snapshot(70)).toBeNull();
    const last = room.at(-1)!;
    expect(last[0]).toBe('tm:state');
    expect((last[1] as { status: string }).status).toBe('C');
    expect(events.map(([e]) => e)).toEqual(['teammaker:finished']);
    await expect(service.publicState(70)).rejects.toMatchObject({ code: 'TEAM_MAKER_NOT_FOUND' });
    await expect(service.pick('b', 0, P(3))).rejects.toBeDefined();
    room.length = 0;
    clock.advance(60_000); // la gracia se canceló: no vuelve a emitir
    expect(room).toEqual([]);
    expect(service.snapshot(70)).toBeNull();
  });

  it('el estado publico de un partido sin armado es TEAM_MAKER_NOT_FOUND', async () => {
    repo.record = null;
    await expect(service.publicState(70)).rejects.toMatchObject({ code: 'TEAM_MAKER_NOT_FOUND' });
  });
});
