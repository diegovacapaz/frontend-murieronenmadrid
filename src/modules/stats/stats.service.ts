import { Inject, Injectable } from '@nestjs/common';
import { GeneralStatsResponseDto } from './dto/general-stats-response.dto';
import { PlayerStatsResponseDto } from './dto/player-stats-response.dto';
import { TournamentStatsResponseDto } from './dto/tournament-stats-response.dto';
import type { IStatsRepository } from './interfaces/stats.repository.interface';
import { STATS_REPOSITORY } from './stats.constants';

/**
 * Umbrales de los destacados del perfil.
 *
 * Son los mismos que usaba el sistema original: sin un minimo de cruces, un
 * unico partido ganado consagra a un "hijo", y sin un minimo de partidos
 * juntos, la mejor quimica es siempre alguien con quien se jugo una vez.
 *
 * Viven aca —capa de negocio— y no clavados en el SQL: son una decision de
 * producto, no una restriccion de la base.
 */
const MIN_MATCHES_AGAINST = 5;
const MIN_MATCHES_TOGETHER = 5;

/**
 * Minimo de partidos para entrar al ranking historico de winrate. Sin el, el
 * podio lo copa quien jugo dos veces y gano las dos.
 *
 * Se exporta porque el dossier de MurieronNews llama a GetGeneralStats con el
 * mismo numero. Si el diario usara otro, podria proclamar un lider historico
 * que la tabla de la app no muestra, y las dos cosas se leen el mismo dia.
 */
export const MIN_MATCHES_FOR_RANKING = 10;

@Injectable()
export class StatsService {
  constructor(
    @Inject(STATS_REPOSITORY)
    private readonly statsRepository: IStatsRepository,
  ) {}

  async findPlayerStats(playerId: number): Promise<PlayerStatsResponseDto> {
    return this.statsRepository.findPlayerStats(
      playerId,
      MIN_MATCHES_AGAINST,
      MIN_MATCHES_TOGETHER,
    );
  }

  async findTournamentStats(tournamentId: number): Promise<TournamentStatsResponseDto> {
    return this.statsRepository.findTournamentStats(tournamentId);
  }

  async findGeneralStats(minMatches?: number): Promise<GeneralStatsResponseDto> {
    return this.statsRepository.findGeneralStats(minMatches ?? MIN_MATCHES_FOR_RANKING);
  }
}
