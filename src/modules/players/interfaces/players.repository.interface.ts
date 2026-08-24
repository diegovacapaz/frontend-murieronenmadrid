import type { EntityState } from '../../../common/enums/entity-state.enum';
import type { Player } from '../entities/player.entity';

export interface SearchPlayersParams {
  state?: EntityState;
  isSagrado?: boolean;
  search?: string;
}

/**
 * Contrato del repository de jugadores.
 *
 * El service depende de esta interfaz y no de la clase: el token
 * PLAYERS_REPOSITORY es lo que el modulo inyecta. Cambiar la implementacion
 * (otra base, un mock en tests) no toca una linea del service.
 */
export interface IPlayersRepository {
  search(params: SearchPlayersParams): Promise<Player[]>;
  findById(playerId: number): Promise<Player | null>;
  create(player: Partial<Player>): Promise<Player>;
  update(playerId: number, player: Partial<Player>): Promise<Player>;
  remove(playerId: number): Promise<Player>;
  findLore(playerId: number): Promise<string>;
  saveLore(playerId: number, notes: string): Promise<void>;
}
