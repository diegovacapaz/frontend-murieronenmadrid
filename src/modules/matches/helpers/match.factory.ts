import { Match } from '../entities/match.entity';
import { MatchDB } from '../interfaces/database';

export class MatchFactory {
  static toObject(db: MatchDB): Match {
    const match = new Match();
    match.matchId = db.matchId;
    match.tournamentId = db.tournamentId;
    match.tournamentName = db.tournamentName;
    match.winnerTeam = db.winnerTeam;
    match.goalsDiference = db.goalsDiference;
    match.place = db.place;
    match.playedAt = db.playedAt;
    match.isDerby = db.isDerby;
    match.players = db.players ?? [];
    return match;
  }

  static toList(dbs: MatchDB[]): Match[] {
    return dbs.map((db) => MatchFactory.toObject(db));
  }
}
