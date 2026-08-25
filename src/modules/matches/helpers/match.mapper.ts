import { CreateMatchDto } from '../dto/create-match.dto';
import { MatchResponseDto } from '../dto/match-response.dto';
import { UpdateMatchDto } from '../dto/update-match.dto';
import { Match } from '../entities/match.entity';
import type { MatchLineupEntry } from '../interfaces/matches.repository.interface';

export class MatchMapper {
  /**
   * El partido, su convocatoria y sus notas viajan juntos al repository, pero
   * como cosas distintas: la cabecera es un Partial<Match>, la formacion es una
   * lista plana que el SP recibe como JSON y las notas son un texto suelto. No
   * se arma un Match completo porque los datos de cada jugador (nombre, foto)
   * los resuelve la base, no el cliente.
   *
   * Las notas salen como `null` cuando no vinieron o vinieron en blanco: el SP
   * trata el null y la cadena vacia igual —borra la fila— pero mandarlo
   * explicito deja claro que "sin notas" es un valor y no un olvido.
   */
  static fromCreateDto(dto: CreateMatchDto): {
    match: Partial<Match>;
    lineup: MatchLineupEntry[];
    notes: string | null;
  } {
    return {
      match: {
        tournamentId: dto.tournamentId,
        winnerTeam: dto.winnerTeam ?? null,
        goalsDiference: dto.goalsDiference,
        place: dto.place,
        playedAt: dto.playedAt,
        isDerby: dto.isDerby ?? false,
      },
      lineup: dto.players.map((player) => ({
        playerId: player.playerId,
        team: player.team,
      })),
      notes: MatchMapper.notas(dto.notes),
    };
  }

  static fromUpdateDto(dto: UpdateMatchDto): {
    match: Partial<Match>;
    lineup: MatchLineupEntry[];
    notes: string | null;
  } {
    return {
      match: {
        winnerTeam: dto.winnerTeam ?? null,
        goalsDiference: dto.goalsDiference,
        place: dto.place,
        playedAt: dto.playedAt,
        isDerby: dto.isDerby ?? false,
      },
      lineup: dto.players.map((player) => ({
        playerId: player.playerId,
        team: player.team,
      })),
      notes: MatchMapper.notas(dto.notes),
    };
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
      players: match.players,
    };
  }

  static toResponseDtoList(matches: Match[]): MatchResponseDto[] {
    return matches.map((match) => MatchMapper.toResponseDto(match));
  }
}
