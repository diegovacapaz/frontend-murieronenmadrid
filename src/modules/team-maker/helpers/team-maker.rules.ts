import type { PickError, PickRef, Seat, TeamMakerState } from '../team-maker.types';

/** Cooldown de emotes por socket. */
export const EMOTE_COOLDOWN_MS = 4000;
/** Cooldown de mensajes por socket. */
export const SAY_COOLDOWN_MS = 6000;
export const SAY_MAX_LENGTH = 40;
export const NICK_MAX_LENGTH = 16;
export const ANONYMOUS_NICK = 'Anónimo';

const other = (seat: Seat): Seat => (seat === 0 ? 1 : 0);

/**
 * De quien es cada eleccion. Los capitanes ya estan en su equipo, asi que hay
 * N - 2 elecciones, siempre de a una: el primero elige una vez y despues se
 * alternan de a dos turnos, empezando por el otro; la ultima cae sola.
 * Para 12: A B B A A B B A A B.
 */
export function buildPickOrder(totalPlayers: number, firstSeat: Seat): Seat[] {
  const picks = totalPlayers - 2;
  const order: Seat[] = [];
  if (picks <= 0) return order;

  order.push(firstSeat);
  let seat = other(firstSeat);
  while (order.length < picks) {
    order.push(seat);
    if (order.length < picks) order.push(seat);
    seat = other(seat);
  }
  return order;
}

/**
 * Quien elige primero: el que esta mas abajo en la tabla del torneo (numero de
 * posicion mayor). Sin posicion (primer partido del torneo) o empatados, se
 * sortea.
 */
export function decideFirstSeat(
  pos: [number | null, number | null],
  random: () => number,
): { firstSeat: Seat; byDraw: boolean } {
  const [a, b] = pos;
  if (a === null || b === null || a === b) {
    return { firstSeat: random() < 0.5 ? 0 : 1, byDraw: true };
  }
  return { firstSeat: a > b ? 0 : 1, byDraw: false };
}

const sameRef = (a: PickRef, b: PickRef): boolean => a.kind === b.kind && a.id === b.id;

/**
 * Si una eleccion es valida. `expectedTurn` es el turno que el cliente cree que
 * esta jugando: si ya paso (doble toque, dos pestañas) la eleccion se rechaza
 * en vez de caer en el turno siguiente.
 */
export function validatePick(
  s: TeamMakerState,
  seat: Seat,
  expectedTurn: number,
  ref: PickRef,
): PickError | null {
  if (s.status !== 'K') return 'NOT_PICKING';
  if (s.paused) return 'PAUSED';
  if (expectedTurn !== s.turn) return 'WRONG_TURN';
  if (s.order[s.turn] !== seat) return 'NOT_YOUR_TURN';
  if (!s.pool.some((entry) => sameRef(entry.ref, ref))) return 'NOT_IN_POOL';
  return null;
}

/**
 * Los colores al final. Votos distintos: cada uno con el suyo. Iguales: la
 * moneda decide quien se lo queda y el otro va con el color restante.
 */
export function resolveColors(
  votes: [string, string],
  isDerby: boolean,
  random: () => number,
): { colors: [string, string]; coinWinner: Seat | null } {
  const options = isDerby ? ['S', 'R'] : ['D', 'L'];
  if (!votes.every((vote) => options.includes(vote))) {
    throw new Error('INVALID_COLOR');
  }

  const [v0, v1] = votes;
  if (v0 !== v1) return { colors: [v0, v1], coinWinner: null };

  const coinWinner: Seat = random() < 0.5 ? 0 : 1;
  const rest = options.find((option) => option !== v0)!;
  const colors: [string, string] = coinWinner === 0 ? [v0, rest] : [rest, v0];
  return { colors, coinWinner };
}

/** Limites de reacciones por socket, con un reloj inyectable para testear. */
export class ReactionLimiter {
  private readonly lastEmote = new Map<string, number>();
  private readonly lastSay = new Map<string, number>();

  constructor(private readonly now: () => number) {}

  tryEmote(id: string): boolean {
    return this.take(this.lastEmote, id, EMOTE_COOLDOWN_MS);
  }

  trySay(id: string): boolean {
    return this.take(this.lastSay, id, SAY_COOLDOWN_MS);
  }

  forget(id: string): void {
    this.lastEmote.delete(id);
    this.lastSay.delete(id);
  }

  private take(map: Map<string, number>, id: string, cooldown: number): boolean {
    const now = this.now();
    const last = map.get(id);
    if (last !== undefined && now - last < cooldown) return false;
    map.set(id, now);
    return true;
  }
}

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

function clean(text: unknown, max: number): string {
  if (typeof text !== 'string') return '';
  return text.replace(CONTROL_CHARS, '').trim().slice(0, max).trim();
}

/** Mensaje de un viewer: limpio y hasta 40. Vacio no se manda. */
export function sanitizeSay(text: unknown): string | null {
  return clean(text, SAY_MAX_LENGTH) || null;
}

/** Apodo de un viewer: limpio y hasta 16. Vacio es Anónimo. */
export function sanitizeNick(text: unknown): string {
  return clean(text, NICK_MAX_LENGTH) || ANONYMOUS_NICK;
}
