import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { TeamEntity } from './entities/team.entity';
import { Team } from './enums/team.enum';
import { TeamFactory } from './helpers/team.factory';
import { TeamDB } from './interfaces/database';
import { ITeamsRepository } from './interfaces/teams.repository.interface';

@Injectable()
export class TeamsRepository implements ITeamsRepository {
  constructor(private readonly db: DatabaseService) {}

  async search(isDerbyTeam?: boolean): Promise<TeamEntity[]> {
    const rows = await this.db.callList<TeamDB>('SearchTeams', [isDerbyTeam ?? null]);
    return TeamFactory.toList(rows);
  }

  async findById(team: Team): Promise<TeamEntity | null> {
    const row = await this.db.callSimpleOrNull<TeamDB>('GetTeamById', [team]);
    return row ? TeamFactory.toObject(row) : null;
  }
}
