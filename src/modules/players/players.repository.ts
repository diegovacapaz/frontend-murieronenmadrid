import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { Player } from './entities/player.entity';
import { PlayerFactory } from './helpers/player.factory';
import { PlayerDB, PlayerLoreDB } from './interfaces/database';
import {
  IPlayersRepository,
  SearchPlayersParams,
} from './interfaces/players.repository.interface';

/**
 * Acceso a datos de jugadores. Solo llama stored procedures y traduce filas a
 * entidades con la factory. No valida reglas de negocio (eso es del SP y del
 * service) ni lanza excepciones HTTP.
 */
@Injectable()
export class PlayersRepository implements IPlayersRepository {
  constructor(private readonly db: DatabaseService) {}

  async search(params: SearchPlayersParams): Promise<Player[]> {
    const rows = await this.db.callList<PlayerDB>('SearchPlayers', [
      params.state ?? null,
      params.isSagrado ?? null,
      params.search ?? null,
    ]);
    return PlayerFactory.toList(rows);
  }

  async findById(playerId: number): Promise<Player | null> {
    const row = await this.db.callSimpleOrNull<PlayerDB>('GetPlayerById', [playerId]);
    return row ? PlayerFactory.toObject(row) : null;
  }

  async create(player: Partial<Player>): Promise<Player> {
    const row = await this.db.callSimple<PlayerDB>('CreatePlayer', [
      player.firstName,
      player.secondName,
      player.nickname,
      player.photo,
      player.isSagrado,
      player.state,
    ]);
    return PlayerFactory.toObject(row);
  }

  async update(playerId: number, player: Partial<Player>): Promise<Player> {
    const row = await this.db.callSimple<PlayerDB>('UpdatePlayer', [
      playerId,
      player.firstName,
      player.secondName,
      player.nickname,
      player.photo,
      player.isSagrado,
      player.state,
    ]);
    return PlayerFactory.toObject(row);
  }

  async remove(playerId: number): Promise<Player> {
    const row = await this.db.callSimple<PlayerDB>('DeletePlayer', [playerId]);
    return PlayerFactory.toObject(row);
  }

  async findLore(playerId: number): Promise<string> {
    const row = await this.db.callSimple<PlayerLoreDB>('GetPlayerLore', [playerId]);
    return row.notes;
  }

  async saveLore(playerId: number, notes: string): Promise<void> {
    await this.db.callExec('UpsertPlayerLore', [playerId, notes]);
  }
}
