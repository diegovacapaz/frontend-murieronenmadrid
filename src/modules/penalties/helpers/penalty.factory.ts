import { Penalty } from '../entities/penalty.entity';
import { PenaltyDB } from '../interfaces/database';

export class PenaltyFactory {
  static toObject(db: PenaltyDB): Penalty {
    const penalty = new Penalty();
    penalty.playerId = db.playerId;
    penalty.tournamentId = db.tournamentId;
    penalty.penalty = db.penalty;
    penalty.playerName = db.playerName;
    penalty.playerPhoto = db.playerPhoto;
    penalty.tournamentName = db.tournamentName;
    penalty.tournamentState = db.tournamentState;
    return penalty;
  }

  static toList(dbs: PenaltyDB[]): Penalty[] {
    return dbs.map((db) => PenaltyFactory.toObject(db));
  }
}
