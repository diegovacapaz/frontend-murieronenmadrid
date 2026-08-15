import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AppErrorCode } from '../../common/constants/error-codes.constants';
import { RealtimeEvent } from '../../realtime/realtime.events';
import { RealtimeService } from '../../realtime/realtime.service';
import { CreatePenaltyDto } from './dto/create-penalty.dto';
import { PenaltyResponseDto } from './dto/penalty-response.dto';
import { SearchPenaltyDto } from './dto/search-penalty.dto';
import { Penalty } from './entities/penalty.entity';
import type { IPenaltiesRepository } from './interfaces/penalties.repository.interface';
import { PENALTIES_REPOSITORY } from './penalties.constants';

@Injectable()
export class PenaltiesService {
  constructor(
    @Inject(PENALTIES_REPOSITORY)
    private readonly penaltiesRepository: IPenaltiesRepository,
    private readonly realtime: RealtimeService,
  ) {}

  private toResponse(penalty: Penalty): PenaltyResponseDto {
    return {
      playerId: penalty.playerId,
      tournamentId: penalty.tournamentId,
      penalty: penalty.penalty,
      playerName: penalty.playerName,
      playerPhoto: penalty.playerPhoto,
      tournamentName: penalty.tournamentName,
      tournamentState: penalty.tournamentState,
    };
  }

  async search(params: SearchPenaltyDto): Promise<PenaltyResponseDto[]> {
    const penalties = await this.penaltiesRepository.search(params);
    return penalties.map((penalty) => this.toResponse(penalty));
  }

  async findOne(tournamentId: number, playerId: number): Promise<PenaltyResponseDto> {
    const penalty = await this.penaltiesRepository.findOne(tournamentId, playerId);

    if (!penalty) {
      throw new NotFoundException({
        message: 'Penalty not found',
        errorCode: AppErrorCode.PENALTY_NOT_FOUND,
      });
    }

    return this.toResponse(penalty);
  }

  async create(dto: CreatePenaltyDto): Promise<PenaltyResponseDto> {
    const created = await this.penaltiesRepository.create(
      dto.tournamentId,
      dto.playerId,
      dto.penalty,
    );
    const response = this.toResponse(created);

    this.realtime.emit(RealtimeEvent.PENALTY_CREATED, response);
    this.realtime.invalidateScoreboard(created.tournamentId);
    return response;
  }

  async update(
    tournamentId: number,
    playerId: number,
    penalty: number,
  ): Promise<PenaltyResponseDto> {
    const updated = await this.penaltiesRepository.update(
      tournamentId,
      playerId,
      penalty,
    );
    const response = this.toResponse(updated);

    this.realtime.emit(RealtimeEvent.PENALTY_UPDATED, response);
    this.realtime.invalidateScoreboard(tournamentId);
    return response;
  }

  async remove(tournamentId: number, playerId: number): Promise<PenaltyResponseDto> {
    const removed = await this.penaltiesRepository.remove(tournamentId, playerId);
    const response = this.toResponse(removed);

    this.realtime.emit(RealtimeEvent.PENALTY_DELETED, response);
    this.realtime.invalidateScoreboard(tournamentId);
    return response;
  }
}
