import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ApiRoute, ApiTag } from '../../common/constants';
import {
  GeneralStandingResponseDto,
  StandingResponseDto,
} from './dto/standing-response.dto';
import { ScoreboardService } from './scoreboard.service';

@ApiTags(ApiTag.SCOREBOARD)
@Controller(ApiRoute.SCOREBOARD)
export class ScoreboardController {
  constructor(private readonly scoreboardService: ScoreboardService) {}

  @Get('general')
  @ApiOperation({
    summary: 'Tabla historica',
    description:
      'Suma todos los torneos. Llega ordenada y numerada: puntos netos, ' +
      'diferencia de gol, winrate.',
  })
  findGeneral(): Promise<GeneralStandingResponseDto[]> {
    return this.scoreboardService.findGeneral();
  }

  @Get('tournaments/:tournamentId')
  @ApiOperation({
    summary: 'Tabla de posiciones de un torneo',
    description: 'Mismo criterio de orden que la historica, con la puntuacion del torneo.',
  })
  @ApiResponse({ status: 404, description: 'Torneo no encontrado' })
  findByTournament(
    @Param('tournamentId', ParseIntPipe) tournamentId: number,
  ): Promise<StandingResponseDto[]> {
    return this.scoreboardService.findByTournament(tournamentId);
  }
}
