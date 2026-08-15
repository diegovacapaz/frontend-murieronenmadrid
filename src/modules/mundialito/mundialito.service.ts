import { Inject, Injectable } from '@nestjs/common';
import {
  MundialitoBoardResponseDto,
  PlayerMundialitoResponseDto,
} from './dto/mundialito-response.dto';
import type { IMundialitoRepository } from './interfaces/mundialito.repository.interface';
import { MUNDIALITO_REPOSITORY } from './mundialito.constants';

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
    return this.mundialitoRepository.findByPlayer(playerId);
  }
}
