import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiRoute, ApiTag } from './common/constants';

@ApiTags(ApiTag.HEALTH)
@Controller(ApiRoute.HEALTH)
export class HealthController {
  /**
   * Chequeo de vida para el orquestador. No toca la base a proposito: responde
   * "el proceso esta arriba y sirviendo HTTP". Si tambien verificara MySQL, una
   * caida momentanea de la base haria que el contenedor se reinicie en loop en
   * vez de esperar a que vuelva.
   */
  @Get()
  @ApiOperation({ summary: 'Chequeo de vida del servicio' })
  check(): { status: string; timestamp: string } {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}
