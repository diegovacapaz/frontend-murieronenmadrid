import {
  MundialitoBall,
  MundialitoBoardEntry,
  MundialitoMedal,
  MundialitoPhaseEliminations,
  MundialitoRun,
  MundialitoSummary,
} from '../entities/mundialito.entity';
import {
  MundialitoBallJson,
  MundialitoBoardEntryDB,
  MundialitoCurrentDB,
  MundialitoMedalDB,
  MundialitoPhaseEliminationsDB,
  MundialitoSummaryDB,
} from '../interfaces/database';

/**
 * Arma las entidades del mundialito desde las filas de la base.
 *
 * Lo unico que hace ademas de copiar campos es ordenar las pelotas por puesto:
 * JSON_ARRAYAGG no garantiza el orden de sus elementos, asi que confiar en el
 * que venga seria confiar en un detalle de implementacion del motor.
 */
export class MundialitoFactory {
  static toMedal(db: MundialitoMedalDB): MundialitoMedal {
    const medal = new MundialitoMedal();
    medal.position = db.position;
    medal.playerId = db.playerId;
    medal.displayName = db.displayName;
    medal.nickname = db.nickname;
    medal.photo = db.photo;
    medal.playerState = db.playerState;
    medal.isSagrado = db.isSagrado;
    medal.cups = db.cups;
    medal.titles = db.titles;
    medal.firstTitleAt = db.firstTitleAt;
    medal.lastTitleAt = db.lastTitleAt;
    return medal;
  }

  static toMedalList(dbs: MundialitoMedalDB[]): MundialitoMedal[] {
    return dbs.map((db) => MundialitoFactory.toMedal(db));
  }

  static toBoardEntry(db: MundialitoBoardEntryDB): MundialitoBoardEntry {
    const entry = new MundialitoBoardEntry();
    entry.playerId = db.playerId;
    entry.displayName = db.displayName;
    entry.nickname = db.nickname;
    entry.photo = db.photo;
    entry.playerState = db.playerState;
    entry.isSagrado = db.isSagrado;
    entry.cups = db.cups;
    entry.titles = db.titles;
    entry.run = MundialitoFactory.toRun(db.playerId, db);
    return entry;
  }

  static toBoardEntryList(dbs: MundialitoBoardEntryDB[]): MundialitoBoardEntry[] {
    return dbs.map((db) => MundialitoFactory.toBoardEntry(db));
  }

  static toCurrent(db: MundialitoCurrentDB | undefined): MundialitoRun | null {
    return db ? MundialitoFactory.toRun(db.playerId, db) : null;
  }

  static toSummary(db: MundialitoSummaryDB): MundialitoSummary {
    const summary = new MundialitoSummary();
    summary.playerId = db.playerId;
    summary.matchesPlayed = db.matchesPlayed;
    summary.runsPlayed = db.runsPlayed;
    summary.titles = db.titles;
    summary.eliminations = db.eliminations;
    summary.bestSlot = db.bestSlot;
    return summary;
  }

  static toEliminationsList(
    dbs: MundialitoPhaseEliminationsDB[],
  ): MundialitoPhaseEliminations[] {
    return dbs.map((db) => {
      const row = new MundialitoPhaseEliminations();
      row.slot = db.slot;
      row.phase = db.phase;
      row.eliminations = db.eliminations;
      return row;
    });
  }

  private static toRun(
    playerId: number,
    db: MundialitoBoardEntryDB | MundialitoCurrentDB,
  ): MundialitoRun {
    const run = new MundialitoRun();
    run.playerId = playerId;
    run.runIndex = db.runIndex;
    run.played = db.played;
    run.groupPoints = db.groupPoints;
    run.status = db.status;
    run.phase = db.phase;
    run.nextSlot = db.nextSlot;
    run.lastPlayedAt = db.lastPlayedAt;
    run.balls = MundialitoFactory.toBalls(db.balls);
    return run;
  }

  private static toBalls(json: MundialitoBallJson[] | null): MundialitoBall[] {
    return [...(json ?? [])]
      .sort((a, b) => a.slot - b.slot)
      .map((raw) => {
        const ball = new MundialitoBall();
        ball.slot = raw.slot;
        ball.phase = raw.phase;
        ball.result = raw.result;
        ball.points = raw.points;
        ball.matchId = raw.matchId;
        return ball;
      });
  }
}
