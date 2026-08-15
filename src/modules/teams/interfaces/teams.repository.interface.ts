import type { TeamEntity } from '../entities/team.entity';
import type { Team } from '../enums/team.enum';

export interface ITeamsRepository {
  search(isDerbyTeam?: boolean): Promise<TeamEntity[]>;
  findById(team: Team): Promise<TeamEntity | null>;
}
