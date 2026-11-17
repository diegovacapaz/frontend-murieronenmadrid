import { Match, MatchGuest } from '../entities/match.entity';
import { MatchState } from '../enums/match-state.enum';
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
    match.state = db.state ?? MatchState.PLAYED;
    match.players = db.players ?? [];
    match.guests = MatchFactory.guests(db.guests);
    return match;
  }

  static toList(dbs: MatchDB[]): Match[] {
    return dbs.map((db) => MatchFactory.toObject(db));
  }

  /**
   * vMatchDetail arma los randoms con JSON_ARRAYAGG, que en MySQL no admite un
   * orden garantizado sin una derivada correlacionada. El orden se pone aca:
   * por equipo (los sin equipo al final) y despues por nombre.
   */
  private static guests(raw: MatchDB['guests']): MatchGuest[] {
    const list: MatchGuest[] = typeof raw === 'string' ? JSON.parse(raw) : (raw ?? []);
    return [...list].sort(
      (a, b) =>
        (a.team ?? '~').localeCompare(b.team ?? '~') || a.name.localeCompare(b.name, 'es'),
    );
  }
}
