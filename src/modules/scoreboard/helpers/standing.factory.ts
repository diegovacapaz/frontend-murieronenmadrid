import { GeneralStanding, Standing } from '../entities/standing.entity';
import { GeneralStandingDB, StandingDB } from '../interfaces/database';

export class StandingFactory {
  static toObject(db: StandingDB): Standing {
    const standing = new Standing();
    StandingFactory.assignCommon(standing, db);
    return standing;
  }

  static toList(dbs: StandingDB[]): Standing[] {
    return dbs.map((db) => StandingFactory.toObject(db));
  }

  static toGeneralObject(db: GeneralStandingDB): GeneralStanding {
    const standing = new GeneralStanding();
    StandingFactory.assignCommon(standing, db);
    standing.tournamentsPlayed = db.tournamentsPlayed;
    standing.championships = db.championships ?? [];
    return standing;
  }

  static toGeneralList(dbs: GeneralStandingDB[]): GeneralStanding[] {
    return dbs.map((db) => StandingFactory.toGeneralObject(db));
  }

  private static assignCommon(standing: Standing, db: StandingDB): void {
    standing.position = db.position;
    standing.playerId = db.playerId;
    standing.displayName = db.displayName;
    standing.nickname = db.nickname;
    standing.photo = db.photo;
    standing.playerState = db.playerState;
    standing.isSagrado = db.isSagrado;
    standing.cups = db.cups;
    standing.played = db.played;
    standing.won = db.won;
    standing.drew = db.drew;
    standing.lost = db.lost;
    standing.goalsDiference = db.goalsDiference;
    standing.points = db.points;
    standing.maxPoints = db.maxPoints;
    standing.winRate = db.winRate;
    standing.penalty = db.penalty;
    standing.netPoints = db.netPoints;
  }
}
