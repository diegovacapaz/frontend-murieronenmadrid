import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiRoute, ApiTag } from '../../common/constants';
import { PoweradeResponseDto } from './dto/powerade-response.dto';
import { PoweradeService } from './powerade.service';

@ApiTags(ApiTag.POWERADE)
@Controller(ApiRoute.POWERADE)
export class PoweradeController {
  constructor(private readonly poweradeService: PoweradeService) {}

  @Get('tournaments/:tournamentId')
  @ApiOperation({
    summary: 'El ranking Powerade vigente de un torneo en juego',
    description:
      'El top 3 que armó la IA, con la frase de cada puesto, la flecha de movimiento ' +
      'respecto de la versión anterior y cuántos partidos se cargaron desde que se ' +
      'publicó. Devuelve `null` —no un 404— cuando no corresponde mostrar nada: el ' +
      'torneo no existe, no está en juego, todavía no hay ninguna versión, o la ' +
      'versión vigente quedó con menos de tres puestos.',
  })
  // El plugin CLI de Swagger no infiere el tipo de una unión con `null`; sin esta
  // línea el `data` sale como un `object` pelado.
  @ApiOkResponse({
    type: PoweradeResponseDto,
    description: 'El ranking vigente, o `null` si no corresponde mostrar nada.',
  })
  findByTournament(
    @Param('tournamentId', ParseIntPipe) tournamentId: number,
  ): Promise<PoweradeResponseDto | null> {
    return this.poweradeService.findByTournament(tournamentId);
  }
}
