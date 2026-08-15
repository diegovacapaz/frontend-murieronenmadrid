import type { EntityState } from '../../../common/enums/entity-state.enum';
import type { Row } from '../../../database/database.types';
import type { MatchResult } from '../../matches/enums/match-result.enum';
import type { MundialitoPhase, MundialitoStatus } from '../enums/mundialito.enums';

/** Cada objeto del JSON `balls` que arma vMundialitoCurrent. */
export interface MundialitoBallJson {
  slot: number;
  phase: MundialitoPhase;
  result: MatchResult;
  points: number;
  matchId: number;
}

/** Columnas del jugador que traen los dos SPs. */
interface MundialitoPlayerFields {
  playerId: number;
  displayName: string;
  nickname: string | null;
  photo: string | null;
  playerState: EntityState;
  isSagrado: boolean;
  cups: number;
}

/** Columnas de la corrida vigente. `balls` llega ya parseado por el typeCast. */
interface MundialitoRunFields {
  runIndex: number;
  played: number;
  groupPoints: number;
  status: MundialitoStatus;
  phase: MundialitoPhase;
  nextSlot: number;
  lastPlayedAt: Date;
  balls: MundialitoBallJson[] | null;
}

export interface MundialitoMedalDB extends Row, MundialitoPlayerFields {
  position: number;
  titles: number;
  firstTitleAt: Date;
  lastTitleAt: Date;
}

export interface MundialitoBoardEntryDB
  extends Row,
    MundialitoPlayerFields,
    MundialitoRunFields {
  titles: number;
}

export interface MundialitoCurrentDB extends Row, MundialitoRunFields {
  playerId: number;
}

export interface MundialitoSummaryDB extends Row {
  playerId: number;
  matchesPlayed: number;
  runsPlayed: number;
  titles: number;
  eliminations: number;
  bestSlot: number;
}

export interface MundialitoPhaseEliminationsDB extends Row {
  slot: number;
  phase: MundialitoPhase;
  eliminations: number;
}
