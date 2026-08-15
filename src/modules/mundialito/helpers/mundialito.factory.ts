import {
  MundialitoBall,
  MundialitoBoardEntry,
  MundialitoGlobalSummary,
  MundialitoHighlight,
  MundialitoMedal,
  MundialitoPerformance,
  MundialitoPhaseEliminations,
  MundialitoRecord,
  MundialitoRun,
  MundialitoSummary,
} from '../entities/mundialito.entity';
import {
  MundialitoBallJson,
  MundialitoBoardEntryDB,
  MundialitoCurrentDB,
  MundialitoGlobalSummaryDB,
  MundialitoHighlightDB,
  MundialitoMedalDB,
  MundialitoPerformanceDB,
  MundialitoPhaseEliminationsDB,
  MundialitoRecordDB,
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
    summary.runsEnded = db.runsEnded;
    summary.qualified = db.qualified;
    summary.qualifiedRate = db.qualifiedRate;
    summary.avgRunLength = db.avgRunLength;
    summary.koPlayed = db.koPlayed;
    summary.koPassed = db.koPassed;
    summary.koRate = db.koRate;
    summary.semis = db.semis;
    summary.finals = db.finals;
    summary.droughtRuns = db.droughtRuns;
    summary.perfectRuns = db.perfectRuns;
    return summary;
  }

  static toGlobalSummary(db: MundialitoGlobalSummaryDB): MundialitoGlobalSummary {
    const summary = new MundialitoGlobalSummary();
    summary.runsEnded = db.runsEnded;
    summary.titles = db.titles;
    summary.coronationRate = db.coronationRate;
    summary.qualified = db.qualified;
    summary.qualifiedRate = db.qualifiedRate;
    summary.avgRunLength = db.avgRunLength;
    summary.players = db.players;
    summary.aliveNow = db.aliveNow;
    summary.inKnockoutNow = db.inKnockoutNow;
    summary.perfectRuns = db.perfectRuns;
    return summary;
  }

  static toPerformanceList(dbs: MundialitoPerformanceDB[]): MundialitoPerformance[] {
    return dbs.map((db) => {
      const row = new MundialitoPerformance();
      row.position = db.position;
      row.playerId = db.playerId;
      row.displayName = db.displayName;
      row.nickname = db.nickname;
      row.photo = db.photo;
      row.playerState = db.playerState;
      row.isSagrado = db.isSagrado;
      row.cups = db.cups;
      row.runsPlayed = db.runsPlayed;
      row.runsEnded = db.runsEnded;
      row.qualified = db.qualified;
      row.qualifiedRate = db.qualifiedRate;
      row.avgRunLength = db.avgRunLength;
      row.koPlayed = db.koPlayed;
      row.koPassed = db.koPassed;
      row.koRate = db.koRate;
      row.semis = db.semis;
      row.finals = db.finals;
      row.titles = db.titles;
      row.bestSlot = db.bestSlot;
      row.droughtRuns = db.droughtRuns;
      return row;
    });
  }

  static toRecordList(dbs: MundialitoRecordDB[]): MundialitoRecord[] {
    return dbs.map((db) => {
      const record = new MundialitoRecord();
      record.kind = db.kind;
      record.playerId = db.playerId;
      record.displayName = db.displayName;
      record.photo = db.photo;
      record.value = db.value;
      return record;
    });
  }

  static toHighlightList(dbs: MundialitoHighlightDB[]): MundialitoHighlight[] {
    return dbs.map((db) => {
      const highlight = new MundialitoHighlight();
      highlight.kind = db.kind;
      highlight.playerId = db.playerId;
      highlight.displayName = db.displayName;
      highlight.photo = db.photo;
      highlight.times = db.times;
      highlight.played = db.played;
      return highlight;
    });
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
