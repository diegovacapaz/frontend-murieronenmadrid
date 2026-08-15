import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ApiRoute, ApiTag } from '../../common/constants';
import {
  MundialitoBoardResponseDto,
  PlayerMundialitoResponseDto,
} from './dto/mundialito-response.dto';
import { MundialitoService } from './mundialito.service';

@ApiTags(ApiTag.MUNDIALITO)
@Controller(ApiRoute.MUNDIALITO)
export class MundialitoController {
  constructor(private readonly mundialitoService: MundialitoService) {}

  @Get()
  @ApiOperation({
    summary: 'Medallero y tablero del mundialito',
    description:
      'El mundialito vigente de cada jugador, ordenado por avance, y quienes ' +
      'ganaron alguno. Se deduce del historial: no hay tabla que lo guarde.',
  })
  findBoard(): Promise<MundialitoBoardResponseDto> {
    return this.mundialitoService.findBoard();
  }

  @Get('players/:playerId')
  @ApiOperation({
    summary: 'Mundialito de un jugador',
    description: 'Su corrida vigente, el resumen historico y en que fase se muere.',
  })
  @ApiResponse({ status: 404, description: 'Jugador no encontrado' })
  findByPlayer(
    @Param('playerId', ParseIntPipe) playerId: number,
  ): Promise<PlayerMundialitoResponseDto> {
    return this.mundialitoService.findByPlayer(playerId);
  }
}
