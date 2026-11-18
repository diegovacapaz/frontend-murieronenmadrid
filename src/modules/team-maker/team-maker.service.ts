import { HttpException, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { AppErrorCode } from '../../common/constants/error-codes.constants';
import { RealtimeEvent, type TeamMakerEventPayload } from '../../realtime/realtime.events';
import { MatchState } from '../matches/enums/match-state.enum';
import {
  buildPickOrder,
  decideFirstSeat,
  ReactionLimiter,
  resolveColors,
  sanitizeNick,
  sanitizeSay,
  validatePick,
} from './helpers/team-maker.rules';
import type {
  ITeamMakerRepository,
  TeamMakerRecord,
} from './interfaces/team-maker.repository.interface';
import type { PickRef, PoolEntry, Seat, SeatState, TeamMakerState } from './team-maker.types';

/** Cuanto se espera a un capitan caido antes de liberar su lugar. */
export const SEAT_GRACE_MS = 8000;
/** Como mucho un "estoy apuntando a" cada tanto por socket. */
export const AIM_THROTTLE_MS = 100;

const EMOTE_ID = /^[a-z0-9_-]{1,40}$/i;

export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export type Notify = (event: RealtimeEvent, payload: unknown) => void;
export type EmitRoom = (matchId: number, event: string, payload: unknown) => void;

/**
 * Error de una accion por socket. `code` es lo que vuelve en el ack: el
 * frontend lo traduce. No es un HttpException porque por el socket no hay
 * status, solo "salio" o "no salio y por que".
 */
export class TeamMakerError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

interface SocketEntry {
  nick: string;
  /** Entro con el codigo vigente del link de capitanes. */
  canClaim: boolean;
  seat: Seat | null;
  lastAim: number;
}

interface LiveMaker {
  record: TeamMakerRecord;
  sockets: Map<string, SocketEntry>;
  seatSocket: [string | null, string | null];
  released: [boolean, boolean];
  graceTimer: [unknown, unknown];
  colors: [string, string] | null;
  /** Las acciones de un mismo armado se ejecutan de a una. */
  queue: Promise<unknown>;
}

const sameRef = (a: PickRef, b: PickRef) => a.kind === b.kind && a.id === b.id;
const hash = (token: string) => createHash('sha256').update(token).digest('hex');


/**
 * El armado en vivo. El servidor es la unica autoridad: valida cada accion con
 * las reglas puras, la guarda en la base y recien despues la difunde.
 *
 * Que ocupar un lugar de capitan sea lo mismo que estar conectado es lo que
 * ordena todo: el lugar se ata a un socket, y si el socket se cae el armado se
 * pone en pausa; pasada la gracia, el lugar queda libre para el mismo jugador.
 *
 * Se construye con `new` (factory provider en el modulo) y no por inyeccion de
 * tipos, para poder testearlo con un repo, un reloj y un azar falsos.
 */
export class TeamMakerService {
  private readonly live = new Map<number, LiveMaker>();
  private readonly socketMatch = new Map<string, number>();
  private readonly limiter: ReactionLimiter;
  private emitRoom: EmitRoom = () => undefined;
  private kick: (socketId: string) => void = () => undefined;

  constructor(
    private readonly repo: ITeamMakerRepository,
    private readonly notify: Notify,
    private readonly clock: Clock,
    private readonly random: () => number,
  ) {
    this.limiter = new ReactionLimiter(() => this.clock.now());
  }

  /** Lo llama el gateway al iniciar: como hablarle a una sala y como echar a un socket. */
  attachRoom(emitRoom: EmitRoom, kick: (socketId: string) => void): void {
    this.emitRoom = emitRoom;
    this.kick = kick;
  }

  // ─────────────────────────────── admin (HTTP) ───────────────────────────────

  async createForMatch(matchId: number): Promise<{ makerId: number; captainCode: string; status: string }> {
    const created = await this.repo.create(matchId, this.newCode());
    const record = await this.reload(matchId);
    this.notify(RealtimeEvent.TEAMMAKER_STARTED, this.eventPayload(record));
    return { ...created, status: 'W' };
  }

  async adminInfo(matchId: number): Promise<{ makerId: number; captainCode: string; status: string }> {
    const record = await this.repo.findByMatch(matchId);
    if (!record) throw this.notFound();
    return { makerId: record.makerId, captainCode: record.captainCode, status: record.status };
  }

  async restart(matchId: number): Promise<{ makerId: number; captainCode: string; status: string }> {
    const record = await this.repo.findByMatch(matchId);
    if (!record) throw this.notFound();
    const captainCode = this.newCode();
    await this.repo.restart(record.makerId, captainCode);
    const fresh = await this.reload(matchId);
    this.notify(RealtimeEvent.TEAMMAKER_UPDATED, this.eventPayload(fresh));
    return { makerId: fresh.makerId, captainCode, status: fresh.status };
  }

  async cancel(matchId: number): Promise<{ makerId: number; captainCode: string; status: string }> {
    const record = await this.repo.findByMatch(matchId);
    if (!record) throw this.notFound();
    await this.repo.cancel(record.makerId);
    const fresh = await this.reload(matchId);
    this.notify(RealtimeEvent.TEAMMAKER_FINISHED, this.eventPayload(fresh));
    this.notify(RealtimeEvent.MATCH_UPDATED, { ...this.eventPayload(fresh), state: MatchState.PREPARING });
    return { makerId: fresh.makerId, captainCode: fresh.captainCode, status: fresh.status };
  }

  // ─────────────────────────────── socket ─────────────────────────────────────

  /**
   * El estado de un armado sin entrar a su sala: lo usa la card de la portada,
   * que no debe contar como viewer. Si no esta en memoria lo rearma de la base.
   */
  async publicState(matchId: number): Promise<TeamMakerState> {
    return this.toState(await this.ensure(matchId));
  }

  /** Estado actual de un armado que esta en memoria (para tests y diagnostico). */
  snapshot(matchId: number): TeamMakerState | null {
    const live = this.live.get(matchId);
    return live ? this.toState(live) : null;
  }

  async join(
    socketId: string,
    matchId: number,
    opts: { code?: string; seatToken?: string; nick?: string },
  ): Promise<{ state: TeamMakerState; seat: Seat | null }> {
    const live = await this.ensure(matchId);
    return this.serialize(live, () => {
      this.socketMatch.set(socketId, matchId);
      const previous = live.sockets.get(socketId);
      const entry: SocketEntry = {
        nick: sanitizeNick(opts.nick),
        canClaim: opts.code === live.record.captainCode,
        seat: previous?.seat ?? null,
        lastAim: 0,
      };
      live.sockets.set(socketId, entry);

      if (opts.seatToken && entry.seat === null) {
        const tokenHash = hash(opts.seatToken);
        const seat = live.record.seats.findIndex((s) => s.tokenHash === tokenHash);
        if (seat === 0 || seat === 1) this.bindSeat(live, seat, socketId);
      }

      this.broadcast(live);
      return { state: this.toState(live), seat: entry.seat };
    });
  }

  async claim(socketId: string, playerId: number): Promise<{ seat: Seat; seatToken: string }> {
    const live = this.liveOf(socketId);
    return this.serialize(live, async () => {
      const entry = live.sockets.get(socketId)!;
      if (!entry.canClaim) throw new TeamMakerError('NOT_CAPTAIN_LINK');
      if (entry.seat !== null) throw new TeamMakerError('ALREADY_CAPTAIN');

      const seats = live.record.seats;
      const own = seats.findIndex((s) => s.playerId === playerId);
      let seat: Seat;
      if (own === 0 || own === 1) {
        if (live.seatSocket[own] !== null) throw new TeamMakerError('SEAT_UNAVAILABLE');
        if (!live.released[own]) throw new TeamMakerError('SEAT_RECONNECTING');
        seat = own;
      } else {
        const free = seats.findIndex((s) => s.playerId === null);
        if (free !== 0 && free !== 1) throw new TeamMakerError('SEAT_UNAVAILABLE');
        seat = free;
      }

      const candidate = live.record.roster.find((e) => e.ref.kind === 'P' && e.ref.id === playerId);
      if (!candidate) throw new TeamMakerError('SEAT_UNAVAILABLE');

      const seatToken = randomBytes(24).toString('base64url');
      try {
        await this.repo.claimSeat(live.record.makerId, seat, playerId, hash(seatToken));
      } catch {
        throw new TeamMakerError('SEAT_UNAVAILABLE');
      }
      seats[seat] = {
        ...seats[seat],
        playerId,
        name: candidate.name,
        photo: candidate.photo,
        tokenHash: hash(seatToken),
      };
      this.bindSeat(live, seat, socketId);

      if (live.record.status === 'W' && seats.every((s) => s.playerId !== null)) {
        await this.startPicking(live);
      }

      this.broadcast(live);
      this.notify(RealtimeEvent.TEAMMAKER_UPDATED, this.eventPayload(live.record));
      return { seat, seatToken };
    });
  }

  aim(socketId: string, ref: PickRef | null): void {
    const live = this.liveOf(socketId);
    const entry = live.sockets.get(socketId)!;
    const state = this.toState(live);
    if (entry.seat === null || state.status !== 'K' || state.order[state.turn] !== entry.seat) return;
    const now = this.clock.now();
    if (now - entry.lastAim < AIM_THROTTLE_MS) return;
    entry.lastAim = now;
    this.emitRoom(live.record.matchId, 'tm:aim', { seat: entry.seat, ref });
  }

  async pick(socketId: string, expectedTurn: number, ref: PickRef): Promise<void> {
    const live = this.liveOf(socketId);
    await this.serialize(live, async () => {
      const seat = this.captainSeat(live, socketId);
      const state = this.toState(live);
      const error = validatePick(state, seat, expectedTurn, ref);
      if (error) throw new TeamMakerError(error);

      const isLast = state.turn === state.order.length - 1;
      try {
        await this.repo.addPick(live.record.makerId, state.turn, seat, ref, isLast);
      } catch {
        throw new TeamMakerError('WRONG_TURN');
      }
      live.record.picks.push({ turn: state.turn, seat, ref });
      if (isLast) live.record.status = 'V';

      this.broadcast(live);
      this.notify(RealtimeEvent.TEAMMAKER_UPDATED, this.eventPayload(live.record));
    });
  }

  async vote(socketId: string, color: string): Promise<void> {
    const live = this.liveOf(socketId);
    await this.serialize(live, async () => {
      const seat = this.captainSeat(live, socketId);
      const state = this.toState(live);
      if (state.status !== 'V') throw new TeamMakerError('NOT_VOTING');
      if (state.paused) throw new TeamMakerError('PAUSED');
      const options = live.record.isDerby ? ['S', 'R'] : ['D', 'L'];
      if (!options.includes(color)) throw new TeamMakerError('INVALID_COLOR');

      await this.repo.setVote(live.record.makerId, seat, color);
      live.record.seats[seat].vote = color;

      const [v0, v1] = live.record.seats.map((s) => s.vote);
      if (v0 && v1) {
        const { colors, coinWinner } = resolveColors([v0, v1], live.record.isDerby, this.random);
        await this.repo.finish(live.record.makerId, colors, coinWinner);
        live.record.status = 'F';
        live.record.coinWinner = coinWinner;
        live.colors = colors;
        this.notify(RealtimeEvent.TEAMMAKER_FINISHED, this.eventPayload(live.record));
        this.notify(RealtimeEvent.MATCH_UPDATED, {
          ...this.eventPayload(live.record),
          state: MatchState.READY,
        });
      }
      this.broadcast(live);
    });
  }

  // async aunque no espere nada: todas las acciones del socket devuelven una
  // promesa, asi el gateway las trata igual y un rechazo es un ack de error.
  // eslint-disable-next-line @typescript-eslint/require-await
  async react(socketId: string, reaction: { emoteId?: unknown; text?: unknown }): Promise<void> {
    const live = this.liveOf(socketId);
    const entry = live.sockets.get(socketId)!;
    if (entry.seat !== null) throw new TeamMakerError('CAPTAIN_CANNOT_REACT');

    if (reaction.emoteId !== undefined) {
      if (typeof reaction.emoteId !== 'string' || !EMOTE_ID.test(reaction.emoteId)) {
        throw new TeamMakerError('INVALID_EMOTE');
      }
      if (!this.limiter.tryEmote(socketId)) throw new TeamMakerError('RATE_LIMITED');
      this.emitRoom(live.record.matchId, 'tm:reaction', {
        nick: entry.nick,
        emoteId: reaction.emoteId,
        at: this.clock.now(),
      });
      return;
    }

    const text = sanitizeSay(reaction.text);
    if (!text) throw new TeamMakerError('EMPTY');
    if (!this.limiter.trySay(socketId)) throw new TeamMakerError('RATE_LIMITED');
    this.emitRoom(live.record.matchId, 'tm:reaction', { nick: entry.nick, text, at: this.clock.now() });
  }

  leave(socketId: string): void {
    const matchId = this.socketMatch.get(socketId);
    this.socketMatch.delete(socketId);
    this.limiter.forget(socketId);
    if (matchId === undefined) return;
    const live = this.live.get(matchId);
    if (!live) return;

    const entry = live.sockets.get(socketId);
    live.sockets.delete(socketId);
    if (entry?.seat !== null && entry?.seat !== undefined && live.seatSocket[entry.seat] === socketId) {
      const seat = entry.seat;
      live.seatSocket[seat] = null;
      live.graceTimer[seat] = this.clock.setTimeout(() => {
        live.graceTimer[seat] = null;
        if (live.seatSocket[seat] === null) {
          live.released[seat] = true;
          this.broadcast(live);
        }
      }, SEAT_GRACE_MS);
    }
    this.broadcast(live);
  }

  // ─────────────────────────────── internos ───────────────────────────────────

  private async ensure(matchId: number): Promise<LiveMaker> {
    const existing = this.live.get(matchId);
    if (existing) return existing;
    const record = await this.repo.findByMatch(matchId);
    if (!record) throw new TeamMakerError('TEAM_MAKER_NOT_FOUND');
    // Puede haberse creado mientras se esperaba a la base.
    const raced = this.live.get(matchId);
    if (raced) return raced;
    const live: LiveMaker = {
      record,
      sockets: new Map(),
      seatSocket: [null, null],
      // Al rearmar desde la base nadie esta conectado todavia: los lugares
      // tomados quedan liberados para su mismo jugador (o su token).
      released: [record.seats[0].playerId !== null, record.seats[1].playerId !== null],
      graceTimer: [null, null],
      colors: null,
      queue: Promise.resolve(),
    };
    this.live.set(matchId, live);
    return live;
  }

  /** Relee de la base despues de un cambio de admin y avisa a la sala. */
  private async reload(matchId: number): Promise<TeamMakerRecord> {
    const record = await this.repo.findByMatch(matchId);
    if (!record) throw this.notFound();
    const live = this.live.get(matchId);
    if (live) {
      const codeChanged = live.record.captainCode !== record.captainCode;
      live.record = record;
      live.colors = null;
      for (const seat of [0, 1] as Seat[]) {
        if (record.seats[seat].playerId === null) {
          const socketId = live.seatSocket[seat];
          if (socketId) live.sockets.get(socketId)!.seat = null;
          live.seatSocket[seat] = null;
          live.released[seat] = false;
          this.clock.clearTimeout(live.graceTimer[seat]);
          live.graceTimer[seat] = null;
        }
      }
      if (codeChanged) live.sockets.forEach((entry) => (entry.canClaim = false));
      this.broadcast(live);
    }
    return record;
  }

  private bindSeat(live: LiveMaker, seat: Seat, socketId: string): void {
    const previous = live.seatSocket[seat];
    if (previous && previous !== socketId) {
      const old = live.sockets.get(previous);
      if (old) old.seat = null;
      this.kick(previous);
    }
    live.seatSocket[seat] = socketId;
    live.released[seat] = false;
    this.clock.clearTimeout(live.graceTimer[seat]);
    live.graceTimer[seat] = null;
    live.sockets.get(socketId)!.seat = seat;
  }

  private async startPicking(live: LiveMaker): Promise<void> {
    const [p0, p1] = live.record.seats.map((s) => s.playerId!) as [number, number];
    const positions = await this.repo.captainPositions(live.record.matchId, [p0, p1]);
    const { firstSeat, byDraw } = decideFirstSeat(positions, this.random);
    await this.repo.startPicking(live.record.makerId, firstSeat, byDraw);
    Object.assign(live.record, { status: 'K', firstSeat, firstByDraw: byDraw });
  }

  private captainSeat(live: LiveMaker, socketId: string): Seat {
    const seat = live.sockets.get(socketId)?.seat;
    if (seat === null || seat === undefined || live.seatSocket[seat] !== socketId) {
      throw new TeamMakerError('NOT_CAPTAIN');
    }
    return seat;
  }

  private liveOf(socketId: string): LiveMaker {
    const matchId = this.socketMatch.get(socketId);
    const live = matchId === undefined ? undefined : this.live.get(matchId);
    if (!live || !live.sockets.has(socketId)) throw new TeamMakerError('NOT_JOINED');
    return live;
  }

  private serialize<T>(live: LiveMaker, fn: () => T | Promise<T>): Promise<T> {
    const run = live.queue.then(fn, fn);
    live.queue = run.catch(() => undefined);
    return run;
  }

  private toState(live: LiveMaker): TeamMakerState {
    const r = live.record;
    const captains = new Set(r.seats.map((s) => s.playerId).filter((id): id is number => id !== null));
    const order = r.firstSeat === null ? [] : buildPickOrder(r.roster.length, r.firstSeat);
    const picked = (entry: PoolEntry) => r.picks.some((p) => sameRef(p.ref, entry.ref));
    const connected = [live.seatSocket[0] !== null, live.seatSocket[1] !== null];

    const seats = r.seats.map(
      (s, i): SeatState => ({
        playerId: s.playerId,
        name: s.name,
        photo: s.photo,
        connected: connected[i],
        released: live.released[i],
        voted: s.vote !== null,
      }),
    ) as [SeatState, SeatState];

    return {
      makerId: r.makerId,
      matchId: r.matchId,
      tournamentId: r.tournamentId,
      isDerby: r.isDerby,
      status: r.status,
      seats,
      candidates: r.roster.filter((e) => e.ref.kind === 'P'),
      roster: r.roster,
      firstSeat: r.firstSeat,
      firstByDraw: r.firstByDraw,
      order,
      turn: r.picks.length,
      pool: r.roster.filter((e) => !(e.ref.kind === 'P' && captains.has(e.ref.id)) && !picked(e)),
      picks: [...r.picks],
      colors: live.colors,
      coinWinner: r.coinWinner,
      viewers: live.sockets.size,
      paused: (r.status === 'K' || r.status === 'V') && !(connected[0] && connected[1]),
    };
  }

  private broadcast(live: LiveMaker): void {
    this.emitRoom(live.record.matchId, 'tm:state', this.toState(live));
  }

  private eventPayload(record: TeamMakerRecord): TeamMakerEventPayload {
    return { matchId: record.matchId, tournamentId: record.tournamentId };
  }

  private newCode(): string {
    return randomBytes(16).toString('base64url');
  }

  private notFound(): HttpException {
    return new NotFoundException({
      message: 'Team maker not found',
      errorCode: AppErrorCode.TEAM_MAKER_NOT_FOUND,
    });
  }
}


