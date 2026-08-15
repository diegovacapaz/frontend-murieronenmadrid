import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AppErrorCode } from '../../common/constants/error-codes.constants';
import { RealtimeEvent } from '../../realtime/realtime.events';
import { RealtimeService } from '../../realtime/realtime.service';
import { CreateTournamentDto } from './dto/create-tournament.dto';
import { SearchTournamentDto } from './dto/search-tournament.dto';
import { TournamentResponseDto } from './dto/tournament-response.dto';
import { UpdateTournamentDto } from './dto/update-tournament.dto';
import { Tournament } from './entities/tournament.entity';
import { TournamentState, TournamentStateAction } from './enums/tournament-state.enum';
import { TournamentMapper } from './helpers/tournament.mapper';
import type { ITournamentsRepository } from './interfaces/tournaments.repository.interface';
import { TOURNAMENTS_REPOSITORY } from './tournaments.constants';

const ACTION_TO_STATE: Record<TournamentStateAction, TournamentState> = {
  [TournamentStateAction.FINISH]: TournamentState.FINISHED,
  [TournamentStateAction.REOPEN]: TournamentState.PLAYING,
};

@Injectable()
export class TournamentsService {
  constructor(
    @Inject(TOURNAMENTS_REPOSITORY)
    private readonly tournamentsRepository: ITournamentsRepository,
    private readonly realtime: RealtimeService,
  ) {}

  private async getTournamentOrFail(tournamentId: number): Promise<Tournament> {
    const tournament = await this.tournamentsRepository.findById(tournamentId);

    if (!tournament) {
      throw new NotFoundException({
        message: 'Tournament not found',
        errorCode: AppErrorCode.TOURNAMENT_NOT_FOUND,
      });
    }

    return tournament;
  }

  async search(params: SearchTournamentDto): Promise<TournamentResponseDto[]> {
    const tournaments = await this.tournamentsRepository.search(params);
    return TournamentMapper.toResponseDtoList(tournaments);
  }

  async findOneById(tournamentId: number): Promise<TournamentResponseDto> {
    const tournament = await this.getTournamentOrFail(tournamentId);
    return TournamentMapper.toResponseDto(tournament);
  }

  async create(dto: CreateTournamentDto): Promise<TournamentResponseDto> {
    const tournament = TournamentMapper.fromCreateDto(dto);

    // Un torneo nace en juego: crear uno ya finalizado no tiene sentido, y si
    // hiciera falta cargar historia, se crea, se cargan los partidos y se cierra.
    tournament.state = TournamentState.PLAYING;

    const created = await this.tournamentsRepository.create(tournament);
    const response = TournamentMapper.toResponseDto(created);

    this.realtime.emit(RealtimeEvent.TOURNAMENT_CREATED, response);
    return response;
  }

  async update(
    tournamentId: number,
    dto: UpdateTournamentDto,
  ): Promise<TournamentResponseDto> {
    const tournament = await this.getTournamentOrFail(tournamentId);

    Object.assign(tournament, TournamentMapper.fromUpdateDto(dto));

    const updated = await this.tournamentsRepository.update(tournamentId, tournament);
    const response = TournamentMapper.toResponseDto(updated);

    this.realtime.emit(RealtimeEvent.TOURNAMENT_UPDATED, response);
    // Cambiar la puntuacion recalcula toda la tabla del torneo y, con ella, la
    // historica: los puntos de cada partido dependen de estos tres numeros.
    this.realtime.invalidateScoreboard(tournamentId);
    return response;
  }

  async setState(
    tournamentId: number,
    action: TournamentStateAction,
  ): Promise<TournamentResponseDto> {
    const state = ACTION_TO_STATE[action];

    // "Ya esta en ese estado" lo valida el SP, que lee y escribe en la misma
    // operacion y no puede quedar en carrera con otra request.
    const updated = await this.tournamentsRepository.setState(tournamentId, state);
    const response = TournamentMapper.toResponseDto(updated);

    this.realtime.emit(RealtimeEvent.TOURNAMENT_UPDATED, response);
    // Finalizar consagra campeon: cambian las copas de los jugadores y, por lo
    // tanto, lo que muestran las tablas.
    this.realtime.invalidateScoreboard(tournamentId);
    return response;
  }

  async remove(tournamentId: number): Promise<TournamentResponseDto> {
    const removed = await this.tournamentsRepository.remove(tournamentId);
    const response = TournamentMapper.toResponseDto(removed);

    this.realtime.emit(RealtimeEvent.TOURNAMENT_DELETED, response);
    this.realtime.invalidateScoreboard(null);
    return response;
  }
}
