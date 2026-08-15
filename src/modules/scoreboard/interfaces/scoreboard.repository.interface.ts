import type { GeneralStanding, Standing } from '../entities/standing.entity';

export interface IScoreboardRepository {
  findByTournament(tournamentId: number): Promise<Standing[]>;
  findGeneral(): Promise<GeneralStanding[]>;
}
