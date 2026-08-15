import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { MundialitoBoard, PlayerMundialito } from './entities/mundialito.entity';
import { MundialitoFactory } from './helpers/mundialito.factory';
import {
  MundialitoBoardEntryDB,
  MundialitoCurrentDB,
  MundialitoMedalDB,
  MundialitoPhaseEliminationsDB,
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
    const [medalWinners, board] = await this.db.callMulti<
      [MundialitoMedalDB[], MundialitoBoardEntryDB[]]
    >('GetMundialitoBoard');

    return {
      medalWinners: MundialitoFactory.toMedalList(medalWinners),
      board: MundialitoFactory.toBoardEntryList(board),
    };
  }

  async findByPlayer(playerId: number): Promise<PlayerMundialito> {
    const [summary, current, eliminationsByPhase] = await this.db.callMulti<
      [MundialitoSummaryDB[], MundialitoCurrentDB[], MundialitoPhaseEliminationsDB[]]
    >('GetPlayerMundialito', [playerId]);

    return {
      summary: MundialitoFactory.toSummary(summary[0]),
      // Sin partidos elegibles no hay corrida: el perfil tiene que abrir igual.
      current: MundialitoFactory.toCurrent(current[0]),
      eliminationsByPhase: MundialitoFactory.toEliminationsList(eliminationsByPhase),
    };
  }
}
