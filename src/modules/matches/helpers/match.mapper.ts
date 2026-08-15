import { CreateMatchDto } from '../dto/create-match.dto';
import { MatchResponseDto } from '../dto/match-response.dto';
import { UpdateMatchDto } from '../dto/update-match.dto';
import { Match } from '../entities/match.entity';
import type { MatchLineupEntry } from '../interfaces/matches.repository.interface';

export class MatchMapper {
  /**
   * El partido y su convocatoria viajan juntos al repository, pero como cosas
   * distintas: la cabecera es un Partial<Match> y la formacion es una lista
   * plana que el SP recibe como JSON. No se arma un Match completo porque los
   * datos de cada jugador (nombre, foto) los resuelve la base, no el cliente.
   */
  static fromCreateDto(dto: CreateMatchDto): {
    match: Partial<Match>;
    lineup: MatchLineupEntry[];
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
    };
  }

  static fromUpdateDto(dto: UpdateMatchDto): {
    match: Partial<Match>;
    lineup: MatchLineupEntry[];
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
    };
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
