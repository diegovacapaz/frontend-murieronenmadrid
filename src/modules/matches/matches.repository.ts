import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { Match } from './entities/match.entity';
import { MatchFactory } from './helpers/match.factory';
import { MatchDB, MatchNotesDB, PlaceDB } from './interfaces/database';
import {
  IMatchesRepository,
  MatchLineupEntry,
  SearchMatchesParams,
} from './interfaces/matches.repository.interface';

@Injectable()
export class MatchesRepository implements IMatchesRepository {
  constructor(private readonly db: DatabaseService) {}

  async search(params: SearchMatchesParams): Promise<Match[]> {
    const rows = await this.db.callList<MatchDB>('SearchMatches', [
      params.tournamentId ?? null,
      params.isDerby ?? null,
      params.playerId ?? null,
    ]);
    return MatchFactory.toList(rows);
  }

  async findById(matchId: number): Promise<Match | null> {
    const row = await this.db.callSimpleOrNull<MatchDB>('GetMatchById', [matchId]);
    return row ? MatchFactory.toObject(row) : null;
  }

  async create(
    match: Partial<Match>,
    lineup: MatchLineupEntry[],
    notes: string | null,
  ): Promise<Match> {
    const row = await this.db.callSimple<MatchDB>('CreateMatch', [
      match.tournamentId,
      match.winnerTeam,
      match.goalsDiference,
      match.place,
      match.playedAt,
      match.isDerby,
      // La convocatoria entra como JSON y el SP la desarma con JSON_TABLE: es la
      // forma de mandar una lista de largo variable a un procedure, que solo
      // acepta parametros escalares.
      JSON.stringify(lineup),
      // Las notas van ULTIMAS y no en el medio: el orden de esta lista es
      // posicional y meterlas antes correria todo lo de abajo un lugar.
      notes,
    ]);
    return MatchFactory.toObject(row);
  }

  async update(
    matchId: number,
    match: Partial<Match>,
    lineup: MatchLineupEntry[],
    notes: string | null,
  ): Promise<Match> {
    const row = await this.db.callSimple<MatchDB>('UpdateMatch', [
      matchId,
      match.winnerTeam,
      match.goalsDiference,
      match.place,
      match.playedAt,
      match.isDerby,
      JSON.stringify(lineup),
      notes,
    ]);
    return MatchFactory.toObject(row);
  }

  async remove(matchId: number): Promise<Match> {
    const row = await this.db.callSimple<MatchDB>('DeleteMatch', [matchId]);
    return MatchFactory.toObject(row);
  }

  async findPlaces(): Promise<string[]> {
    const rows = await this.db.callList<PlaceDB>('SearchPlaces');
    return rows.map((row) => row.place);
  }

  async findNotes(matchId: number): Promise<string> {
    const row = await this.db.callSimple<MatchNotesDB>('GetMatchNotes', [matchId]);
    return row.notes;
  }
}
