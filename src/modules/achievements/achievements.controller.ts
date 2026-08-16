import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ApiRoute, ApiTag } from '../../common/constants';
import { AchievementsService } from './achievements.service';
import { PlayerAchievementsResponseDto } from './dto/achievement-response.dto';

@ApiTags(ApiTag.ACHIEVEMENTS)
@Controller(ApiRoute.ACHIEVEMENTS)
export class AchievementsController {
  constructor(private readonly achievementsService: AchievementsService) {}

  @Get('players/:playerId')
  @ApiOperation({
    summary: 'Logros de un jugador',
    description:
      'Los 28 logros con su estado: obtenido, bloqueado o roto. No se guardan ' +
      'en ninguna tabla, se deducen del historial en el momento de pedirlos.',
  })
  @ApiResponse({ status: 404, description: 'Jugador no encontrado' })
  findByPlayer(
    @Param('playerId', ParseIntPipe) playerId: number,
  ): Promise<PlayerAchievementsResponseDto> {
    return this.achievementsService.findByPlayer(playerId);
  }
}
