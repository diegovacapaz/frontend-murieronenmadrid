import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { Tournament } from './entities/tournament.entity';
import { TournamentState } from './enums/tournament-state.enum';
import { TournamentFactory } from './helpers/tournament.factory';
import { TournamentDB } from './interfaces/database';
import {
  ITournamentsRepository,
  SearchTournamentsParams,
} from './interfaces/tournaments.repository.interface';

@Injectable()
export class TournamentsRepository implements ITournamentsRepository {
  constructor(private readonly db: DatabaseService) {}

  async search(params: SearchTournamentsParams): Promise<Tournament[]> {
    const rows = await this.db.callList<TournamentDB>('SearchTournaments', [
      params.state ?? null,
      params.wasTracked ?? null,
    ]);
    return TournamentFactory.toList(rows);
  }

  async findById(tournamentId: number): Promise<Tournament | null> {
    const row = await this.db.callSimpleOrNull<TournamentDB>('GetTournamentById', [
      tournamentId,
    ]);
    return row ? TournamentFactory.toObject(row) : null;
  }

  async create(tournament: Partial<Tournament>): Promise<Tournament> {
    const row = await this.db.callSimple<TournamentDB>('CreateTournament', [
      tournament.name,
      tournament.startedAt,
      tournament.endedAt,
      tournament.state,
      tournament.wasTracked,
      tournament.winningPoints,
      tournament.drawingPoints,
      tournament.lossingPoints,
    ]);
    return TournamentFactory.toObject(row);
  }

  async update(
    tournamentId: number,
    tournament: Partial<Tournament>,
  ): Promise<Tournament> {
    const row = await this.db.callSimple<TournamentDB>('UpdateTournament', [
      tournamentId,
      tournament.name,
      tournament.startedAt,
      tournament.endedAt,
      tournament.wasTracked,
      tournament.winningPoints,
      tournament.drawingPoints,
      tournament.lossingPoints,
    ]);
    return TournamentFactory.toObject(row);
  }

  async setState(tournamentId: number, state: TournamentState): Promise<Tournament> {
    const row = await this.db.callSimple<TournamentDB>('SetTournamentState', [
      tournamentId,
      state,
    ]);
    return TournamentFactory.toObject(row);
  }

  async remove(tournamentId: number): Promise<Tournament> {
    const row = await this.db.callSimple<TournamentDB>('DeleteTournament', [tournamentId]);
    return TournamentFactory.toObject(row);
  }
}
