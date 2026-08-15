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
import { CreatePenaltyDto } from './dto/create-penalty.dto';
import { PenaltyResponseDto } from './dto/penalty-response.dto';
import { SearchPenaltyDto } from './dto/search-penalty.dto';
import { UpdatePenaltyDto } from './dto/update-penalty.dto';
import { PenaltiesService } from './penalties.service';

/**
 * La ruta lleva las dos partes de la clave: /penalties/:tournamentId/:playerId.
 * Es fea de leer pero honesta — la PK es compuesta y no hay un id propio que
 * inventar.
 */
@ApiTags(ApiTag.PENALTIES)
@ApiResponse({ status: 401, description: 'Falta el token de admin (solo escritura)' })
@Controller(ApiRoute.PENALTIES)
export class PenaltiesController {
  constructor(private readonly penaltiesService: PenaltiesService) {}

  @Get()
  @ApiOperation({ summary: 'Listar penalizaciones' })
  search(@Query() filterDto: SearchPenaltyDto): Promise<PenaltyResponseDto[]> {
    return this.penaltiesService.search(filterDto);
  }

  @Get(':tournamentId/:playerId')
  @ApiOperation({ summary: 'Obtener la penalizacion de un jugador en un torneo' })
  @ApiResponse({ status: 404, description: 'Penalizacion no encontrada' })
  findOne(
    @Param('tournamentId', ParseIntPipe) tournamentId: number,
    @Param('playerId', ParseIntPipe) playerId: number,
  ): Promise<PenaltyResponseDto> {
    return this.penaltiesService.findOne(tournamentId, playerId);
  }

  @Post()
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Penalizar a un jugador',
    description: 'Solo en torneos en juego. Un jugador no puede tener dos en el mismo torneo.',
  })
  @ApiResponse({ status: 400, description: 'El torneo esta finalizado o el valor es invalido' })
  @ApiResponse({ status: 404, description: 'Torneo o jugador inexistente' })
  @ApiResponse({ status: 409, description: 'Ya tiene una penalizacion en ese torneo' })
  create(@Body() createPenaltyDto: CreatePenaltyDto): Promise<PenaltyResponseDto> {
    return this.penaltiesService.create(createPenaltyDto);
  }

  @Patch(':tournamentId/:playerId')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cambiar el valor de una penalizacion' })
  @ApiResponse({ status: 400, description: 'El torneo esta finalizado o el valor es invalido' })
  @ApiResponse({ status: 404, description: 'Penalizacion no encontrada' })
  update(
    @Param('tournamentId', ParseIntPipe) tournamentId: number,
    @Param('playerId', ParseIntPipe) playerId: number,
    @Body() dto: UpdatePenaltyDto,
  ): Promise<PenaltyResponseDto> {
    return this.penaltiesService.update(tournamentId, playerId, dto.penalty);
  }

  @Delete(':tournamentId/:playerId')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Quitar una penalizacion' })
  @ApiResponse({ status: 400, description: 'El torneo esta finalizado' })
  @ApiResponse({ status: 404, description: 'Penalizacion no encontrada' })
  remove(
    @Param('tournamentId', ParseIntPipe) tournamentId: number,
    @Param('playerId', ParseIntPipe) playerId: number,
  ): Promise<PenaltyResponseDto> {
    return this.penaltiesService.remove(tournamentId, playerId);
  }
}
