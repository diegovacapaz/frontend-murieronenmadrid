import type { MundialitoBoard, PlayerMundialito } from '../entities/mundialito.entity';

export interface IMundialitoRepository {
  findBoard(): Promise<MundialitoBoard>;
  findByPlayer(playerId: number, minAgainst: number): Promise<PlayerMundialito>;
}
