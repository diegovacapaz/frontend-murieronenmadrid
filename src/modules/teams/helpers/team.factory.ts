import { TeamEntity } from '../entities/team.entity';
import { TeamDB } from '../interfaces/database';

export class TeamFactory {
  static toObject(db: TeamDB): TeamEntity {
    const team = new TeamEntity();
    team.team = db.team;
    team.isDerbyTeam = db.isDerbyTeam;
    return team;
  }

  static toList(dbs: TeamDB[]): TeamEntity[] {
    return dbs.map((db) => TeamFactory.toObject(db));
  }
}
