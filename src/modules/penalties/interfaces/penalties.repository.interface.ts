import type { Penalty } from '../entities/penalty.entity';

export interface SearchPenaltiesParams {
  tournamentId?: number;
  playerId?: number;
}

export interface IPenaltiesRepository {
  search(params: SearchPenaltiesParams): Promise<Penalty[]>;
  findOne(tournamentId: number, playerId: number): Promise<Penalty | null>;
  create(tournamentId: number, playerId: number, penalty: number): Promise<Penalty>;
  update(tournamentId: number, playerId: number, penalty: number): Promise<Penalty>;
  remove(tournamentId: number, playerId: number): Promise<Penalty>;
}
