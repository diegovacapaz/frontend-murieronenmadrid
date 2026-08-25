import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AdminOnly } from '../../auth/decorators/admin-only.decorator';
import { ApiRoute, ApiTag } from '../../common/constants';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { CreatePlayerDto } from './dto/create-player.dto';
import { PlayerLoreResponseDto, UpdatePlayerLoreDto } from './dto/player-lore.dto';
import { PlayerResponseDto } from './dto/player-response.dto';
import { SearchPlayerDto } from './dto/search-player.dto';
import { TogglePlayerStateDto } from './dto/toggle-player-state.dto';
import { UpdatePlayerDto } from './dto/update-player.dto';
import { PlayersService } from './players.service';

@ApiTags(ApiTag.PLAYERS)
@ApiResponse({ status: 401, description: 'Falta el token de admin (solo escritura)' })
@Controller(ApiRoute.PLAYERS)
export class PlayersController {
  constructor(private readonly playersService: PlayersService) {}

  @Get()
  @ApiOperation({
    summary: 'Listar jugadores',
    description:
      'Devuelve el padron completo con copas y titulos ya calculados. Sin ' +
      'paginacion: el volumen es chico y el frontend lo quiere entero.',
  })
  search(@Query() filterDto: SearchPlayerDto): Promise<PlayerResponseDto[]> {
    return this.playersService.search(filterDto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener un jugador por id' })
  @ApiResponse({ status: 404, description: 'Jugador no encontrado' })
  findOneById(@Param('id', ParseIntPipe) id: number): Promise<PlayerResponseDto> {
    return this.playersService.findOneById(id);
  }

  @Post()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Crear un jugador (nace activo)' })
  @ApiResponse({ status: 400, description: 'Datos invalidos' })
  create(@Body() createPlayerDto: CreatePlayerDto): Promise<PlayerResponseDto> {
    return this.playersService.create(createPlayerDto);
  }

  @Patch(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Editar un jugador' })
  @ApiResponse({ status: 404, description: 'Jugador no encontrado' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updatePlayerDto: UpdatePlayerDto,
  ): Promise<PlayerResponseDto> {
    return this.playersService.update(id, updatePlayerDto);
  }

  @Patch(':id/state')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Activar o desactivar un jugador',
    description:
      'Un jugador inactivo no puede ser convocado a partidos nuevos, pero su ' +
      'historial sigue contando en todas las tablas.',
  })
  @ApiResponse({ status: 400, description: 'Ya esta en ese estado' })
  @ApiResponse({ status: 404, description: 'Jugador no encontrado' })
  toggleState(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: TogglePlayerStateDto,
  ): Promise<PlayerResponseDto> {
    return this.playersService.toggleState(id, dto.action);
  }

  @Delete(':id')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Borrar un jugador',
    description:
      'Solo si esta inactivo, no jugo ningun partido y no tiene penalizaciones.',
  })
  @ApiResponse({ status: 400, description: 'El jugador esta activo' })
  @ApiResponse({ status: 404, description: 'Jugador no encontrado' })
  @ApiResponse({ status: 409, description: 'El jugador tiene historial cargado' })
  remove(@Param('id', ParseIntPipe) id: number): Promise<PlayerResponseDto> {
    return this.playersService.remove(id);
  }

  @Get(':playerId/lore')
  @AdminOnly()
  @ApiOperation({
    summary: 'Notas personales de un jugador (solo admin)',
    description:
      'El material con el que el diario le da color a las crónicas. Es la ' +
      'única lectura del sistema que exige token: son chistes internos sobre ' +
      'personas reales y no tienen por qué ser públicos.',
  })
  @ApiResponse({ status: 401, description: 'Falta el token de admin' })
  @ApiResponse({ status: 404, description: 'Jugador no encontrado' })
  findLore(
    @Param('playerId', ParseIntPipe) playerId: number,
  ): Promise<PlayerLoreResponseDto> {
    return this.playersService.findLore(playerId);
  }

  @Put(':playerId/lore')
  @ApiOperation({
    summary: 'Guardar las notas de un jugador',
    description: 'Mandar notas vacías borra el lore.',
  })
  @ApiResponse({ status: 404, description: 'Jugador no encontrado' })
  @ResponseMessage('Notas guardadas')
  saveLore(
    @Param('playerId', ParseIntPipe) playerId: number,
    @Body() dto: UpdatePlayerLoreDto,
  ): Promise<void> {
    return this.playersService.saveLore(playerId, dto.notes);
  }
}
