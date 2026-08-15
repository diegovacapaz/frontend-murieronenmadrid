import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { GeneralStanding, Standing } from './entities/standing.entity';
import { StandingFactory } from './helpers/standing.factory';
import { GeneralStandingDB, StandingDB } from './interfaces/database';
import { IScoreboardRepository } from './interfaces/scoreboard.repository.interface';

@Injectable()
export class ScoreboardRepository implements IScoreboardRepository {
  constructor(private readonly db: DatabaseService) {}

  async findByTournament(tournamentId: number): Promise<Standing[]> {
    const rows = await this.db.callList<StandingDB>('GetTournamentScoreboard', [
      tournamentId,
    ]);
    return StandingFactory.toList(rows);
  }

  async findGeneral(): Promise<GeneralStanding[]> {
    const rows = await this.db.callList<GeneralStandingDB>('GetGeneralScoreboard');
    return StandingFactory.toGeneralList(rows);
  }
}
