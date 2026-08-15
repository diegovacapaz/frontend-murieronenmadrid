import { CreatePlayerDto } from '../dto/create-player.dto';
import { PlayerResponseDto } from '../dto/player-response.dto';
import { UpdatePlayerDto } from '../dto/update-player.dto';
import { Player } from '../entities/player.entity';

/**
 * Traduce entre DTOs y el modelo de dominio. Lo usa el service; ni el
 * controller ni el repository saben de estas conversiones.
 */
export class PlayerMapper {
  static fromCreateDto(dto: CreatePlayerDto): Partial<Player> {
    return {
      firstName: dto.firstName,
      secondName: dto.secondName,
      nickname: dto.nickname ?? null,
      photo: dto.photo ?? null,
      isSagrado: dto.isSagrado ?? false,
    };
  }

  /**
   * Solo devuelve las claves presentes en el DTO.
   *
   * Es la diferencia entre PATCH y PUT: si copiara los `undefined`, un
   * Object.assign sobre la entidad existente borraria el apodo de quien lo
   * tiene solo por no haberlo mandado.
   */
  static fromUpdateDto(dto: UpdatePlayerDto): Partial<Player> {
    const target: Partial<Player> = {};
    if (dto.firstName !== undefined) target.firstName = dto.firstName;
    if (dto.secondName !== undefined) target.secondName = dto.secondName;
    if (dto.nickname !== undefined) target.nickname = dto.nickname || null;
    if (dto.photo !== undefined) target.photo = dto.photo || null;
    if (dto.isSagrado !== undefined) target.isSagrado = dto.isSagrado;
    return target;
  }

  static toResponseDto(player: Player): PlayerResponseDto {
    return {
      playerId: player.playerId,
      firstName: player.firstName,
      secondName: player.secondName,
      nickname: player.nickname,
      displayName: player.displayName,
      photo: player.photo,
      state: player.state,
      isSagrado: player.isSagrado,
      createdAt: player.createdAt,
      cups: player.cups,
      championships: player.championships,
    };
  }

  static toResponseDtoList(players: Player[]): PlayerResponseDto[] {
    return players.map((player) => PlayerMapper.toResponseDto(player));
  }
}
