import { CreateTournamentDto } from '../dto/create-tournament.dto';
import { TournamentResponseDto } from '../dto/tournament-response.dto';
import { UpdateTournamentDto } from '../dto/update-tournament.dto';
import { Tournament } from '../entities/tournament.entity';

export class TournamentMapper {
  static fromCreateDto(dto: CreateTournamentDto): Partial<Tournament> {
    return {
      name: dto.name,
      startedAt: dto.startedAt,
      endedAt: dto.endedAt,
      winningPoints: dto.winningPoints,
      drawingPoints: dto.drawingPoints,
      lossingPoints: dto.lossingPoints,
      wasTracked: dto.wasTracked ?? true,
    };
  }

  /** Solo las claves presentes: ver el comentario de PlayerMapper.fromUpdateDto. */
  static fromUpdateDto(dto: UpdateTournamentDto): Partial<Tournament> {
    const target: Partial<Tournament> = {};
    if (dto.name !== undefined) target.name = dto.name;
    if (dto.startedAt !== undefined) target.startedAt = dto.startedAt;
    if (dto.endedAt !== undefined) target.endedAt = dto.endedAt;
    if (dto.winningPoints !== undefined) target.winningPoints = dto.winningPoints;
    if (dto.drawingPoints !== undefined) target.drawingPoints = dto.drawingPoints;
    if (dto.lossingPoints !== undefined) target.lossingPoints = dto.lossingPoints;
    if (dto.wasTracked !== undefined) target.wasTracked = dto.wasTracked;
    return target;
  }

  static toResponseDto(tournament: Tournament): TournamentResponseDto {
    return {
      tournamentId: tournament.tournamentId,
      name: tournament.name,
      startedAt: tournament.startedAt,
      endedAt: tournament.endedAt,
      state: tournament.state,
      wasTracked: tournament.wasTracked,
      winningPoints: tournament.winningPoints,
      drawingPoints: tournament.drawingPoints,
      lossingPoints: tournament.lossingPoints,
      createdAt: tournament.createdAt,
      matchesCount: tournament.matchesCount,
      derbiesCount: tournament.derbiesCount,
      playersCount: tournament.playersCount,
      penaltiesCount: tournament.penaltiesCount,
      championPlayerId: tournament.championPlayerId,
      championName: tournament.championName,
    };
  }

  static toResponseDtoList(tournaments: Tournament[]): TournamentResponseDto[] {
    return tournaments.map((tournament) => TournamentMapper.toResponseDto(tournament));
  }
}
