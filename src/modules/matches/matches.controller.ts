import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthService } from '../../auth/auth.service';
import { AdminOnly } from '../../auth/decorators/admin-only.decorator';
import { ApiRoute, ApiTag } from '../../common/constants';
import { CreateMatchDto } from './dto/create-match.dto';
import { FinishMatchDto } from './dto/finish-match.dto';
import { MatchNotesResponseDto } from './dto/match-notes.dto';
import { MatchResponseDto } from './dto/match-response.dto';
import { SearchMatchDto } from './dto/search-match.dto';
import { SetTeamsDto } from './dto/set-teams.dto';
import { UpdateMatchDto } from './dto/update-match.dto';
import { MatchesService } from './matches.service';

@ApiTags(ApiTag.MATCHES)
@ApiResponse({ status: 401, description: 'Falta el token de admin (solo escritura)' })
@Controller(ApiRoute.MATCHES)
export class MatchesController {
  constructor(
    private readonly matchesService: MatchesService,
    private readonly authService: AuthService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Listar partidos',
    description: 'Del mas reciente al mas viejo, cada uno con su convocatoria completa.',
  })
  search(
    @Query() filterDto: SearchMatchDto,
    @Headers('authorization') authorization?: string,
  ): Promise<MatchResponseDto[]> {
    return this.matchesService.search(filterDto, this.authService.isAdminAuthorization(authorization));
  }

  // Antes de ':id', por la misma razon que 'places'.
  @Get('upcoming')
  @ApiOperation({
    summary: 'Proximos partidos',
    description:
      'Los listos (equipos armados, sin resultado) y los que se estan armando en ' +
      'vivo con el team maker. Alimenta la card de la portada y del torneo.',
  })
  findUpcoming(): Promise<MatchResponseDto[]> {
    return this.matchesService.findUpcoming();
  }

  // Antes de ':id': si no, Nest interpreta "places" como un id y responde 400.
  @Get('places')
  @ApiOperation({
    summary: 'Canchas ya usadas',
    description:
      'Valores distintos de `place` ordenados por uso, para sugerirlos al ' +
      'cargar un partido. No hay catálogo de canchas: el lugar es texto libre.',
  })
  findPlaces(): Promise<string[]> {
    return this.matchesService.findPlaces();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener un partido por id' })
  @ApiResponse({ status: 404, description: 'Partido no encontrado' })
  findOneById(
    @Param('id', ParseIntPipe) id: number,
    @Headers('authorization') authorization?: string,
  ): Promise<MatchResponseDto> {
    return this.matchesService.findOneById(id, this.authService.isAdminAuthorization(authorization));
  }

  @Get(':matchId/notes')
  @AdminOnly()
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Notas del administrador sobre un partido (solo admin)',
    description:
      'Lo que pasó esa tarde adentro de la cancha y ningún resultado puede ' +
      'contar. Es material del diario, no del grupo, así que esta lectura ' +
      'exige token — igual que el lore de los jugadores. Se cargan al dar de ' +
      'alta o editar el partido; este endpoint solo las devuelve para ' +
      'precargar el formulario.',
  })
  @ApiResponse({ status: 401, description: 'Falta el token de admin' })
  @ApiResponse({ status: 404, description: 'Partido no encontrado' })
  findNotes(
    @Param('matchId', ParseIntPipe) matchId: number,
  ): Promise<MatchNotesResponseDto> {
    return this.matchesService.findNotes(matchId);
  }

  @Post()
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Cargar un partido',
    description:
      'El torneo tiene que estar en juego. Un derby solo admite equipos ' +
      'Sagrado y Resto del Mundo; un partido comun, solo Dark y Light.',
  })
  @ApiResponse({
    status: 400,
    description:
      'Resultado incoherente, equipos que no corresponden, jugador repetido ' +
      'o jugador inactivo',
  })
  @ApiResponse({ status: 404, description: 'Torneo o jugador inexistente' })
  create(@Body() createMatchDto: CreateMatchDto): Promise<MatchResponseDto> {
    return this.matchesService.create(createMatchDto);
  }

  @Patch(':id')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Editar un partido',
    description:
      'Reemplaza el partido entero, convocatoria incluida. Solo en torneos en ' +
      'juego. Los jugadores que ya estaban se aceptan aunque hoy esten inactivos.',
  })
  @ApiResponse({ status: 400, description: 'El torneo esta finalizado o los datos son incoherentes' })
  @ApiResponse({ status: 404, description: 'Partido no encontrado' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateMatchDto: UpdateMatchDto,
  ): Promise<MatchResponseDto> {
    return this.matchesService.update(id, updateMatchDto);
  }

  @Put(':id/teams')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Armar los equipos a mano',
    description:
      'En preparacion -> listo. Tienen que venir exactamente los convocados y ' +
      'randoms del partido, cada uno con equipo, en dos equipos parejos.',
  })
  @ApiResponse({ status: 400, description: 'Total impar, equipos desparejos o convocatoria distinta' })
  setTeams(
    @Param('id', ParseIntPipe) id: number,
    @Body() setTeamsDto: SetTeamsDto,
  ): Promise<MatchResponseDto> {
    return this.matchesService.setTeams(id, setTeamsDto);
  }

  @Delete(':id/teams')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Deshacer los equipos', description: 'Listo -> en preparacion.' })
  clearTeams(@Param('id', ParseIntPipe) id: number): Promise<MatchResponseDto> {
    return this.matchesService.clearTeams(id);
  }

  @Post(':id/finish')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Finalizar un partido',
    description: 'Listo -> jugado: resultado y relato. Desde aca el partido cuenta.',
  })
  finish(
    @Param('id', ParseIntPipe) id: number,
    @Body() finishMatchDto: FinishMatchDto,
  ): Promise<MatchResponseDto> {
    return this.matchesService.finish(id, finishMatchDto);
  }

  @Delete(':id')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Borrar un partido',
    description: 'Solo de torneos en juego. Se lleva su convocatoria.',
  })
  @ApiResponse({ status: 400, description: 'El torneo esta finalizado' })
  @ApiResponse({ status: 404, description: 'Partido no encontrado' })
  remove(@Param('id', ParseIntPipe) id: number): Promise<MatchResponseDto> {
    return this.matchesService.remove(id);
  }
}
