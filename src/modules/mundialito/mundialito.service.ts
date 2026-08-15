import { Inject, Injectable } from '@nestjs/common';
import {
  MundialitoBoardResponseDto,
  PlayerMundialitoResponseDto,
} from './dto/mundialito-response.dto';
import type { IMundialitoRepository } from './interfaces/mundialito.repository.interface';
import { MUNDIALITO_REPOSITORY } from './mundialito.constants';

/**
 * Cruces minimos contra un rival para que pueda ser verdugo o victima del
 * mundialito.
 *
 * Es el mismo numero que usan los destacados del cara a cara, y por la misma
 * razon: sin un minimo, alguien que jugo dos veces en contra y lo elimino en
 * las dos queda consagrado como su bestia negra. Vive aca —capa de negocio— y
 * no clavado en el SQL: es una decision de producto.
 */
const MIN_MATCHES_AGAINST = 5;

/**
 * Igual que el service del scoreboard, este no calcula nada: el formato del
 * mundialito —cuando se clasifica, cuando se queda afuera, cuando se da la
 * vuelta— vive entero en vMundialitoRuns. Si la regla se repitiera aca,
 * existirian dos mundialitos y tarde o temprano dirian cosas distintas.
 *
 * El 404 de jugador inexistente lo señaliza el SP.
 */
@Injectable()
export class MundialitoService {
  constructor(
    @Inject(MUNDIALITO_REPOSITORY)
    private readonly mundialitoRepository: IMundialitoRepository,
  ) {}

  async findBoard(): Promise<MundialitoBoardResponseDto> {
    return this.mundialitoRepository.findBoard();
  }

  async findByPlayer(playerId: number): Promise<PlayerMundialitoResponseDto> {
    return this.mundialitoRepository.findByPlayer(playerId, MIN_MATCHES_AGAINST);
  }
}
