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
import { CreateTournamentDto } from './dto/create-tournament.dto';
import { SearchTournamentDto } from './dto/search-tournament.dto';
import { SetTournamentStateDto } from './dto/set-tournament-state.dto';
import { TournamentResponseDto } from './dto/tournament-response.dto';
import { UpdateTournamentDto } from './dto/update-tournament.dto';
import { TournamentsService } from './tournaments.service';

@ApiTags(ApiTag.TOURNAMENTS)
@ApiResponse({ status: 401, description: 'Falta el token de admin (solo escritura)' })
@Controller(ApiRoute.TOURNAMENTS)
export class TournamentsController {
  constructor(private readonly tournamentsService: TournamentsService) {}

  @Get()
  @ApiOperation({
    summary: 'Listar torneos',
    description: 'Ordenados del mas reciente al mas viejo, con sus contadores y campeon.',
  })
  search(@Query() filterDto: SearchTournamentDto): Promise<TournamentResponseDto[]> {
    return this.tournamentsService.search(filterDto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener un torneo por id' })
  @ApiResponse({ status: 404, description: 'Torneo no encontrado' })
  findOneById(@Param('id', ParseIntPipe) id: number): Promise<TournamentResponseDto> {
    return this.tournamentsService.findOneById(id);
  }

  @Post()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Crear un torneo (nace en juego)' })
  @ApiResponse({ status: 409, description: 'Ya existe un torneo con ese nombre' })
  create(@Body() createTournamentDto: CreateTournamentDto): Promise<TournamentResponseDto> {
    return this.tournamentsService.create(createTournamentDto);
  }

  @Patch(':id')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Editar un torneo',
    description:
      'Solo mientras esta en juego. Para corregir uno finalizado hay que ' +
      'reabrirlo primero.',
  })
  @ApiResponse({ status: 400, description: 'El torneo esta finalizado o las fechas son invalidas' })
  @ApiResponse({ status: 404, description: 'Torneo no encontrado' })
  @ApiResponse({ status: 409, description: 'Ya existe otro torneo con ese nombre' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateTournamentDto: UpdateTournamentDto,
  ): Promise<TournamentResponseDto> {
    return this.tournamentsService.update(id, updateTournamentDto);
  }

  @Patch(':id/state')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Finalizar o reabrir un torneo',
    description: 'Finalizarlo consagra al campeon y congela sus partidos.',
  })
  @ApiResponse({ status: 400, description: 'Ya esta en ese estado' })
  @ApiResponse({ status: 404, description: 'Torneo no encontrado' })
  setState(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetTournamentStateDto,
  ): Promise<TournamentResponseDto> {
    return this.tournamentsService.setState(id, dto.action);
  }

  @Delete(':id')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Borrar un torneo',
    description: 'Solo si no tiene partidos ni penalizaciones cargadas.',
  })
  @ApiResponse({ status: 404, description: 'Torneo no encontrado' })
  @ApiResponse({ status: 409, description: 'El torneo tiene historial cargado' })
  remove(@Param('id', ParseIntPipe) id: number): Promise<TournamentResponseDto> {
    return this.tournamentsService.remove(id);
  }
}
