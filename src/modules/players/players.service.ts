import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AppErrorCode } from '../../common/constants/error-codes.constants';
import { EntityState, StatusAction } from '../../common/enums/entity-state.enum';
import { RealtimeEvent } from '../../realtime/realtime.events';
import { RealtimeService } from '../../realtime/realtime.service';
import { CreatePlayerDto } from './dto/create-player.dto';
import { PlayerLoreResponseDto } from './dto/player-lore.dto';
import { PlayerResponseDto } from './dto/player-response.dto';
import { SearchPlayerDto } from './dto/search-player.dto';
import { UpdatePlayerDto } from './dto/update-player.dto';
import { Player } from './entities/player.entity';
import { PlayerMapper } from './helpers/player.mapper';
import type { IPlayersRepository } from './interfaces/players.repository.interface';
import { PLAYERS_REPOSITORY } from './players.constants';

/** Traduccion del verbo de la API al estado que guarda la base. */
const ACTION_TO_STATE: Record<StatusAction, EntityState> = {
  [StatusAction.ACTIVATE]: EntityState.ACTIVE,
  [StatusAction.DEACTIVATE]: EntityState.INACTIVE,
};

@Injectable()
export class PlayersService {
  constructor(
    @Inject(PLAYERS_REPOSITORY)
    private readonly playersRepository: IPlayersRepository,
    private readonly realtime: RealtimeService,
  ) {}

  private async getPlayerOrFail(playerId: number): Promise<Player> {
    const player = await this.playersRepository.findById(playerId);

    if (!player) {
      throw new NotFoundException({
        message: 'Player not found',
        errorCode: AppErrorCode.PLAYER_NOT_FOUND,
      });
    }

    return player;
  }

  async search(params: SearchPlayerDto): Promise<PlayerResponseDto[]> {
    const players = await this.playersRepository.search(params);
    return PlayerMapper.toResponseDtoList(players);
  }

  async findOneById(playerId: number): Promise<PlayerResponseDto> {
    const player = await this.getPlayerOrFail(playerId);
    return PlayerMapper.toResponseDto(player);
  }

  async create(dto: CreatePlayerDto): Promise<PlayerResponseDto> {
    const player = PlayerMapper.fromCreateDto(dto);

    // Un jugador nace activo, siempre. El estado no es parte del DTO de alta
    // justamente para que no se pueda crear a alguien ya dado de baja.
    player.state = EntityState.ACTIVE;

    const created = await this.playersRepository.create(player);
    const response = PlayerMapper.toResponseDto(created);

    this.realtime.emit(RealtimeEvent.PLAYER_CREATED, response);
    return response;
  }

  async update(playerId: number, dto: UpdatePlayerDto): Promise<PlayerResponseDto> {
    // Se lee primero para mergear: el SP recibe la fila completa y no tiene que
    // adivinar que campos venian en el PATCH.
    const player = await this.getPlayerOrFail(playerId);

    Object.assign(player, PlayerMapper.fromUpdateDto(dto));

    const updated = await this.playersRepository.update(playerId, player);
    const response = PlayerMapper.toResponseDto(updated);

    this.realtime.emit(RealtimeEvent.PLAYER_UPDATED, response);
    return response;
  }

  async toggleState(playerId: number, action: StatusAction): Promise<PlayerResponseDto> {
    const player = await this.getPlayerOrFail(playerId);
    const newState = ACTION_TO_STATE[action];

    if (player.state === newState) {
      throw new BadRequestException({
        message: 'Player is already in the requested state',
        errorCode: AppErrorCode.PLAYER_ALREADY_IN_STATE,
      });
    }

    player.state = newState;

    const updated = await this.playersRepository.update(playerId, player);
    const response = PlayerMapper.toResponseDto(updated);

    this.realtime.emit(RealtimeEvent.PLAYER_UPDATED, response);
    return response;
  }

  /**
   * Las tres condiciones para borrar (inactivo, sin partidos, sin
   * penalizaciones) las valida el SP, que es quien puede mirar las tablas
   * relacionadas en la misma transaccion. Aca no se duplican: duplicarlas
   * abriria la puerta a que un dia digan cosas distintas.
   */
  async remove(playerId: number): Promise<PlayerResponseDto> {
    const removed = await this.playersRepository.remove(playerId);
    const response = PlayerMapper.toResponseDto(removed);

    this.realtime.emit(RealtimeEvent.PLAYER_DELETED, response);
    return response;
  }

  /**
   * El 404 de jugador inexistente lo señaliza el SP, igual que en el resto del
   * módulo: no hace falta preguntar primero si existe.
   */
  async findLore(playerId: number): Promise<PlayerLoreResponseDto> {
    return { notes: await this.playersRepository.findLore(playerId) };
  }

  async saveLore(playerId: number, notes: string): Promise<void> {
    await this.playersRepository.saveLore(playerId, notes);
  }
}
