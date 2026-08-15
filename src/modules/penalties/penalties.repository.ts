import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { Penalty } from './entities/penalty.entity';
import { PenaltyFactory } from './helpers/penalty.factory';
import { PenaltyDB } from './interfaces/database';
import {
  IPenaltiesRepository,
  SearchPenaltiesParams,
} from './interfaces/penalties.repository.interface';

@Injectable()
export class PenaltiesRepository implements IPenaltiesRepository {
  constructor(private readonly db: DatabaseService) {}

  async search(params: SearchPenaltiesParams): Promise<Penalty[]> {
    const rows = await this.db.callList<PenaltyDB>('SearchPenalties', [
      params.tournamentId ?? null,
      params.playerId ?? null,
    ]);
    return PenaltyFactory.toList(rows);
  }

  async findOne(tournamentId: number, playerId: number): Promise<Penalty | null> {
    const row = await this.db.callSimpleOrNull<PenaltyDB>('GetPenalty', [
      tournamentId,
      playerId,
    ]);
    return row ? PenaltyFactory.toObject(row) : null;
  }

  async create(
    tournamentId: number,
    playerId: number,
    penalty: number,
  ): Promise<Penalty> {
    const row = await this.db.callSimple<PenaltyDB>('CreatePlayerPenalty', [
      tournamentId,
      playerId,
      penalty,
    ]);
    return PenaltyFactory.toObject(row);
  }

  async update(
    tournamentId: number,
    playerId: number,
    penalty: number,
  ): Promise<Penalty> {
    const row = await this.db.callSimple<PenaltyDB>('UpdatePlayerPenalty', [
      tournamentId,
      playerId,
      penalty,
    ]);
    return PenaltyFactory.toObject(row);
  }

  async remove(tournamentId: number, playerId: number): Promise<Penalty> {
    const row = await this.db.callSimple<PenaltyDB>('DeletePlayerPenalty', [
      tournamentId,
      playerId,
    ]);
    return PenaltyFactory.toObject(row);
  }
}
