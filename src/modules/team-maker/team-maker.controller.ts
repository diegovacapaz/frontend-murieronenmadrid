import { Controller, Delete, Get, Param, ParseIntPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AdminOnly } from '../../auth/decorators/admin-only.decorator';
import { ApiRoute, ApiTag } from '../../common/constants';
import { TeamMakerAdminResponseDto } from './dto/team-maker-admin-response.dto';
import { TeamMakerService } from './team-maker.service';

/**
 * Lo que hace el admin con un team maker: abrirlo, ver el link, reiniciarlo y
 * cancelarlo. Todo lo que pasa adentro del armado (capitanes, elecciones,
 * votos, emotes) entra por el socket del namespace /team-maker.
 */
@ApiTags(ApiTag.TEAM_MAKER)
@ApiBearerAuth()
@ApiResponse({ status: 401, description: 'Falta el token de admin' })
@Controller(ApiRoute.MATCHES)
export class TeamMakerController {
  constructor(private readonly teamMakerService: TeamMakerService) {}

  @Post(':id/team-maker')
  @ApiOperation({
    summary: 'Abrir el team maker de un partido',
    description:
      'El partido tiene que estar en preparacion, con un total par de al menos 4 ' +
      'y sin otro maker activo. Devuelve el codigo del link de capitanes.',
  })
  @ApiResponse({ status: 400, description: 'Total impar o menos de 4' })
  create(@Param('id', ParseIntPipe) id: number): Promise<TeamMakerAdminResponseDto> {
    return this.teamMakerService.createForMatch(id);
  }

  @Get(':id/team-maker/admin')
  @AdminOnly()
  @ApiOperation({ summary: 'Ver el link de capitanes del maker del partido' })
  @ApiResponse({ status: 404, description: 'El partido no tiene team maker' })
  admin(@Param('id', ParseIntPipe) id: number): Promise<TeamMakerAdminResponseDto> {
    return this.teamMakerService.adminInfo(id);
  }

  @Post(':id/team-maker/restart')
  @ApiOperation({
    summary: 'Reiniciar el team maker',
    description: 'Libera los lugares, borra elecciones y votos y genera un link nuevo.',
  })
  restart(@Param('id', ParseIntPipe) id: number): Promise<TeamMakerAdminResponseDto> {
    return this.teamMakerService.restart(id);
  }

  @Delete(':id/team-maker')
  @ApiOperation({
    summary: 'Cancelar el team maker',
    description: 'El partido vuelve a quedar en preparacion, sin equipos.',
  })
  cancel(@Param('id', ParseIntPipe) id: number): Promise<TeamMakerAdminResponseDto> {
    return this.teamMakerService.cancel(id);
  }
}
