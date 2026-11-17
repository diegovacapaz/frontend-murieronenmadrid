import { CreateMatchDto, MatchGuestDto, MatchPlayerDto } from '../dto/create-match.dto';
import { FinishMatchDto } from '../dto/finish-match.dto';
import { MatchResponseDto } from '../dto/match-response.dto';
import { SetTeamsDto } from '../dto/set-teams.dto';
import { UpdateMatchDto } from '../dto/update-match.dto';
import { Match } from '../entities/match.entity';
import { MatchState } from '../enums/match-state.enum';
import type {
  FinishMatchParams,
  GuestTeamEntry,
  MatchGuestEntry,
  MatchLineupEntry,
} from '../interfaces/matches.repository.interface';

interface MatchWrite {
  match: Partial<Match>;
  lineup: MatchLineupEntry[];
  guests: MatchGuestEntry[];
  notes: string | null;
}

export class MatchMapper {
  /**
   * El partido, su convocatoria, sus randoms y sus notas viajan juntos al
   * repository, pero como cosas distintas: la cabecera es un Partial<Match>,
   * la formacion y los randoms son listas planas que el SP recibe como JSON y
   * las notas son un texto suelto. No se arma un Match completo porque los
   * datos de cada jugador (nombre, foto) los resuelve la base, no el cliente.
   *
   * Las notas salen como `null` cuando no vinieron o vinieron en blanco: el SP
   * trata el null y la cadena vacia igual —borra la fila— pero mandarlo
   * explicito deja claro que "sin notas" es un valor y no un olvido.
   */
  static fromCreateDto(dto: CreateMatchDto): MatchWrite {
    return {
      match: { ...MatchMapper.header(dto), tournamentId: dto.tournamentId },
      lineup: MatchMapper.lineup(dto.players),
      guests: MatchMapper.guests(dto.guests),
      notes: MatchMapper.notas(dto.notes),
    };
  }

  static fromUpdateDto(dto: UpdateMatchDto): MatchWrite {
    return {
      match: MatchMapper.header(dto),
      lineup: MatchMapper.lineup(dto.players),
      guests: MatchMapper.guests(dto.guests),
      notes: MatchMapper.notas(dto.notes),
    };
  }

  static fromSetTeamsDto(dto: SetTeamsDto): { lineup: MatchLineupEntry[]; guests: GuestTeamEntry[] } {
    return {
      lineup: dto.players.map(({ playerId, team }) => ({ playerId, team })),
      guests: dto.guests.map(({ guestId, team }) => ({ guestId, team })),
    };
  }

  static fromFinishDto(dto: FinishMatchDto): FinishMatchParams {
    return {
      winnerTeam: dto.winnerTeam ?? null,
      goalsDiference: dto.goalsDiference,
      notes: MatchMapper.notas(dto.notes),
    };
  }

  private static header(dto: UpdateMatchDto): Partial<Match> {
    return {
      winnerTeam: dto.winnerTeam ?? null,
      goalsDiference: dto.goalsDiference,
      place: dto.place,
      playedAt: dto.playedAt,
      isDerby: dto.isDerby ?? false,
      state: dto.state ?? MatchState.PLAYED,
    };
  }

  private static lineup(players: MatchPlayerDto[]): MatchLineupEntry[] {
    return players.map((player) => ({ playerId: player.playerId, team: player.team ?? null }));
  }

  private static guests(guests: MatchGuestDto[] | undefined): MatchGuestEntry[] {
    return (guests ?? []).map((guest) => ({ name: guest.name.trim(), team: guest.team ?? null }));
  }

  /** Ausente, vacio o solo espacios es lo mismo: el partido no tiene notas. */
  private static notas(notes: string | undefined): string | null {
    return notes?.trim() ? notes.trim() : null;
  }

  static toResponseDto(match: Match): MatchResponseDto {
    return {
      matchId: match.matchId,
      tournamentId: match.tournamentId,
      tournamentName: match.tournamentName,
      winnerTeam: match.winnerTeam,
      goalsDiference: match.goalsDiference,
      place: match.place,
      playedAt: match.playedAt,
      isDerby: match.isDerby,
      state: match.state,
      players: match.players,
      guests: match.guests,
    };
  }

  static toResponseDtoList(matches: Match[]): MatchResponseDto[] {
    return matches.map((match) => MatchMapper.toResponseDto(match));
  }
}
