import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ApiRoute, ApiTag } from '../../common/constants';
import { GeneralStatsQueryDto } from './dto/general-stats-query.dto';
import { GeneralStatsResponseDto } from './dto/general-stats-response.dto';
import { PlayerStatsResponseDto } from './dto/player-stats-response.dto';
import { TournamentStatsResponseDto } from './dto/tournament-stats-response.dto';
import { StatsService } from './stats.service';

@ApiTags(ApiTag.STATS)
@Controller(ApiRoute.STATS)
export class StatsController {
  constructor(private readonly statsService: StatsService) {}

  @Get('general')
  @ApiOperation({
    summary: 'Estadisticas historicas',
    description:
      'Totales del sistema, cruce entre equipos, vitrina de campeones, linea ' +
      'de tiempo de torneos, ranking de winrate y records. Todo calculado en la base.',
  })
  findGeneralStats(
    @Query() query: GeneralStatsQueryDto,
  ): Promise<GeneralStatsResponseDto> {
    return this.statsService.findGeneralStats(query.minMatches);
  }

  @Get('players/:playerId')
  @ApiOperation({
    summary: 'Estadisticas de un jugador',
    description:
      'El perfil completo: totales, rendimiento por torneo, evolucion del ' +
      'winrate, cara a cara con cada rival y companiero, y los destacados ' +
      '(victima, verdugo, clasico, mejor y peor quimica).',
  })
  @ApiResponse({ status: 404, description: 'Jugador no encontrado' })
  findPlayerStats(
    @Param('playerId', ParseIntPipe) playerId: number,
  ): Promise<PlayerStatsResponseDto> {
    return this.statsService.findPlayerStats(playerId);
  }

  @Get('tournaments/:tournamentId')
  @ApiOperation({
    summary: 'Estadisticas de un torneo',
    description:
      'Resumen, rendimiento por equipo, cruce equipo vs equipo (separando ' +
      'derbies), canchas y linea de tiempo de partidos.',
  })
  @ApiResponse({ status: 404, description: 'Torneo no encontrado' })
  findTournamentStats(
    @Param('tournamentId', ParseIntPipe) tournamentId: number,
  ): Promise<TournamentStatsResponseDto> {
    return this.statsService.findTournamentStats(tournamentId);
  }
}
