import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { MundialitoBoard, PlayerMundialito } from './entities/mundialito.entity';
import { MundialitoFactory } from './helpers/mundialito.factory';
import {
  MundialitoBoardEntryDB,
  MundialitoCurrentDB,
  MundialitoGlobalSummaryDB,
  MundialitoHighlightDB,
  MundialitoMedalDB,
  MundialitoPerformanceDB,
  MundialitoPhaseEliminationsDB,
  MundialitoRecordDB,
  MundialitoSummaryDB,
} from './interfaces/database';
import { IMundialitoRepository } from './interfaces/mundialito.repository.interface';

/**
 * Una llamada por pantalla. El orden de la desestructuracion es el contrato con
 * mundialito.sql y esta documentado en el encabezado de cada SP.
 */
@Injectable()
export class MundialitoRepository implements IMundialitoRepository {
  constructor(private readonly db: DatabaseService) {}

  async findBoard(): Promise<MundialitoBoard> {
    const [medalWinners, board, summary, performance, eliminations, records] =
      await this.db.callMulti<
        [
          MundialitoMedalDB[],
          MundialitoBoardEntryDB[],
          MundialitoGlobalSummaryDB[],
          MundialitoPerformanceDB[],
          MundialitoPhaseEliminationsDB[],
          MundialitoRecordDB[],
        ]
      >('GetMundialitoBoard');

    return {
      medalWinners: MundialitoFactory.toMedalList(medalWinners),
      board: MundialitoFactory.toBoardEntryList(board),
      summary: MundialitoFactory.toGlobalSummary(summary[0]),
      performance: MundialitoFactory.toPerformanceList(performance),
      eliminationsByPhase: MundialitoFactory.toEliminationsList(eliminations),
      records: MundialitoFactory.toRecordList(records),
    };
  }

  async findByPlayer(playerId: number, minAgainst: number): Promise<PlayerMundialito> {
    const [summary, current, eliminationsByPhase, highlights, bestRun] =
      await this.db.callMulti<
        [
          MundialitoSummaryDB[],
          MundialitoCurrentDB[],
          MundialitoPhaseEliminationsDB[],
          MundialitoHighlightDB[],
          MundialitoCurrentDB[],
        ]
      >('GetPlayerMundialito', [playerId, minAgainst]);

    return {
      summary: MundialitoFactory.toSummary(summary[0]),
      // Sin partidos elegibles no hay corrida: el perfil tiene que abrir igual.
      current: MundialitoFactory.toCurrent(current[0]),
      eliminationsByPhase: MundialitoFactory.toEliminationsList(eliminationsByPhase),
      highlights: MundialitoFactory.toHighlightList(highlights),
      bestRun: MundialitoFactory.toCurrent(bestRun[0]),
    };
  }
}
