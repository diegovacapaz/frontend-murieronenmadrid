import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ApiRoute, ApiTag } from '../../common/constants';
import { CreateMatchDto } from './dto/create-match.dto';
import { MatchResponseDto } from './dto/match-response.dto';
import { SearchMatchDto } from './dto/search-match.dto';
import { UpdateMatchDto } from './dto/update-match.dto';
import { MatchesService } from './matches.service';

@ApiTags(ApiTag.MATCHES)
@ApiResponse({ status: 401, description: 'Falta el token de admin (solo escritura)' })
@Controller(ApiRoute.MATCHES)
export class MatchesController {
  constructor(private readonly matchesService: MatchesService) {}

  @Get()
  @ApiOperation({
    summary: 'Listar partidos',
    description: 'Del mas reciente al mas viejo, cada uno con su convocatoria completa.',
  })
  search(@Query() filterDto: SearchMatchDto): Promise<MatchResponseDto[]> {
    return this.matchesService.search(filterDto);
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
  findOneById(@Param('id', ParseIntPipe) id: number): Promise<MatchResponseDto> {
    return this.matchesService.findOneById(id);
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
