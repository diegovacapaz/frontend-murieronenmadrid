import { Tournament } from '../entities/tournament.entity';
import { TournamentDB } from '../interfaces/database';

export class TournamentFactory {
  static toObject(db: TournamentDB): Tournament {
    const tournament = new Tournament();
    tournament.tournamentId = db.tournamentId;
    tournament.name = db.name;
    tournament.startedAt = db.startedAt;
    tournament.endedAt = db.endedAt;
    tournament.state = db.state;
    tournament.wasTracked = db.wasTracked;
    tournament.winningPoints = db.winningPoints;
    tournament.lossingPoints = db.lossingPoints;
    tournament.drawingPoints = db.drawingPoints;
    tournament.createdAt = db.createdAt;
    tournament.matchesCount = db.matchesCount;
    tournament.derbiesCount = db.derbiesCount;
    tournament.playersCount = db.playersCount;
    tournament.penaltiesCount = db.penaltiesCount;
    tournament.championPlayerId = db.championPlayerId;
    tournament.championName = db.championName;
    return tournament;
  }

  static toList(dbs: TournamentDB[]): Tournament[] {
    return dbs.map((db) => TournamentFactory.toObject(db));
  }
}
