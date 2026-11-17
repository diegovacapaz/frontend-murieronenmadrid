import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { Match } from './entities/match.entity';
import { MatchFactory } from './helpers/match.factory';
import { MatchDB, MatchNotesDB, PlaceDB } from './interfaces/database';
import {
  FinishMatchParams,
  GuestTeamEntry,
  IMatchesRepository,
  MatchGuestEntry,
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
      params.includePending ?? false,
    ]);
    return MatchFactory.toList(rows);
  }

  async findById(matchId: number): Promise<Match | null> {
    const row = await this.db.callSimpleOrNull<MatchDB>('GetMatchById', [matchId]);
    return row ? MatchFactory.toObject(row) : null;
  }

  async findUpcoming(): Promise<Match[]> {
    const rows = await this.db.callList<MatchDB>('GetUpcomingMatches');
    return MatchFactory.toList(rows);
  }

  async create(
    match: Partial<Match>,
    lineup: MatchLineupEntry[],
    guests: MatchGuestEntry[],
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
      notes,
      // Estado y randoms van al final: el orden de esta lista es posicional y
      // agregarlos en el medio correria todo lo de abajo un lugar.
      match.state,
      JSON.stringify(guests),
    ]);
    return MatchFactory.toObject(row);
  }

  async update(
    matchId: number,
    match: Partial<Match>,
    lineup: MatchLineupEntry[],
    guests: MatchGuestEntry[],
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
      match.state,
      JSON.stringify(guests),
    ]);
    return MatchFactory.toObject(row);
  }

  async setTeams(
    matchId: number,
    lineup: MatchLineupEntry[],
    guests: GuestTeamEntry[],
  ): Promise<Match> {
    const row = await this.db.callSimple<MatchDB>('SetMatchTeams', [
      matchId,
      JSON.stringify(lineup),
      JSON.stringify(guests),
    ]);
    return MatchFactory.toObject(row);
  }

  async clearTeams(matchId: number): Promise<Match> {
    const row = await this.db.callSimple<MatchDB>('ClearMatchTeams', [matchId]);
    return MatchFactory.toObject(row);
  }

  async finish(matchId: number, params: FinishMatchParams): Promise<Match> {
    const row = await this.db.callSimple<MatchDB>('FinishMatch', [
      matchId,
      params.winnerTeam,
      params.goalsDiference,
      params.notes,
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
