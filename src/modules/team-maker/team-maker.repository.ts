import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import {
  CaptainPositionsDB,
  CreatedTeamMakerDB,
  TeamMakerDB,
  TeamMakerPickDB,
  TeamMakerRosterDB,
  TeamMakerSeatDB,
} from './interfaces/database';
import type {
  ITeamMakerRepository,
  SeatRecord,
  TeamMakerRecord,
} from './interfaces/team-maker.repository.interface';
import type { PickRef, Seat } from './team-maker.types';

const asSeat = (n: number | null): Seat | null => (n === null ? null : n === 0 ? 0 : 1);

@Injectable()
export class TeamMakerRepository implements ITeamMakerRepository {
  constructor(private readonly db: DatabaseService) {}

  async create(matchId: number, captainCode: string): Promise<{ makerId: number; captainCode: string }> {
    const row = await this.db.callSimple<CreatedTeamMakerDB>('CreateTeamMaker', [matchId, captainCode]);
    return { makerId: row.makerId, captainCode: row.captainCode };
  }

  async findByMatch(matchId: number): Promise<TeamMakerRecord | null> {
    const [makers, seats, picks, roster] = await this.db.callMulti<
      [TeamMakerDB[], TeamMakerSeatDB[], TeamMakerPickDB[], TeamMakerRosterDB[]]
    >('GetTeamMakerByMatch', [matchId]);

    const maker = makers[0];
    if (!maker) return null;

    const seat = (n: number): SeatRecord => {
      const s = seats.find((row) => row.seat === n);
      return {
        playerId: s?.playerId ?? null,
        name: s?.name ?? null,
        photo: s?.photo ?? null,
        tokenHash: s?.tokenHash ?? null,
        vote: s?.vote ?? null,
      };
    };

    return {
      makerId: maker.makerId,
      matchId: maker.matchId,
      tournamentId: maker.tournamentId,
      isDerby: Boolean(maker.isDerby),
      status: maker.state,
      captainCode: maker.captainCode,
      firstSeat: asSeat(maker.firstSeat),
      firstByDraw: Boolean(maker.firstByDraw),
      coinWinner: asSeat(maker.coinWinner),
      seats: [seat(0), seat(1)],
      picks: picks.map((p) => ({
        turn: p.turn,
        seat: asSeat(p.seat)!,
        ref: p.playerId !== null ? { kind: 'P', id: p.playerId } : { kind: 'G', id: p.guestId! },
      })),
      roster: roster.map((r) => ({ ref: { kind: r.kind, id: r.id }, name: r.name, photo: r.photo })),
    };
  }

  async claimSeat(makerId: number, seat: Seat, playerId: number, tokenHash: string): Promise<void> {
    await this.db.callList('ClaimTeamMakerSeat', [makerId, seat, playerId, tokenHash]);
  }

  async captainPositions(
    matchId: number,
    [p0, p1]: [number, number],
  ): Promise<[number | null, number | null]> {
    const row = await this.db.callSimple<CaptainPositionsDB>('GetCaptainPositions', [matchId, p0, p1]);
    return [row.pos0 ?? null, row.pos1 ?? null];
  }

  async startPicking(makerId: number, firstSeat: Seat, byDraw: boolean): Promise<void> {
    await this.db.callExec('StartTeamMakerPicking', [makerId, firstSeat, byDraw]);
  }

  async addPick(makerId: number, turn: number, seat: Seat, ref: PickRef, isLast: boolean): Promise<void> {
    await this.db.callExec('AddTeamMakerPick', [
      makerId,
      turn,
      seat,
      ref.kind === 'P' ? ref.id : null,
      ref.kind === 'G' ? ref.id : null,
      isLast,
    ]);
  }

  async setVote(makerId: number, seat: Seat, vote: string): Promise<void> {
    await this.db.callExec('SetTeamMakerVote', [makerId, seat, vote]);
  }

  async finish(makerId: number, [c0, c1]: [string, string], coinWinner: Seat | null): Promise<void> {
    await this.db.callList('FinishTeamMaker', [makerId, c0, c1, coinWinner]);
  }

  async cancel(makerId: number): Promise<void> {
    await this.db.callList('CancelTeamMaker', [makerId]);
  }

  async restart(makerId: number, captainCode: string): Promise<void> {
    await this.db.callList('RestartTeamMaker', [makerId, captainCode]);
  }
}
