import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AppErrorCode } from '../../common/constants/error-codes.constants';
import { RealtimeEvent } from '../../realtime/realtime.events';
import { RealtimeService } from '../../realtime/realtime.service';
import { CreateMatchDto } from './dto/create-match.dto';
import { MatchNotesResponseDto } from './dto/match-notes.dto';
import { MatchResponseDto } from './dto/match-response.dto';
import { SearchMatchDto } from './dto/search-match.dto';
import { UpdateMatchDto } from './dto/update-match.dto';
import { Match } from './entities/match.entity';
import { MatchMapper } from './helpers/match.mapper';
import type { IMatchesRepository } from './interfaces/matches.repository.interface';
import { MATCHES_REPOSITORY } from './matches.constants';

/**
 * Las reglas duras de un partido (torneo en juego, coherencia entre ganador y
 * diferencia, equipos que corresponden al tipo de partido, jugadores activos y
 * sin repetir) viven en los stored procedures.
 *
 * No es pereza: son controles que necesitan mirar varias tablas a la vez y
 * dentro de la misma transaccion que hace el INSERT. Validarlos tambien aca
 * seria duplicar logica que un dia va a divergir, y ademas dejaria una ventana
 * de carrera entre el chequeo y la escritura.
 *
 * Lo que si es responsabilidad de este service: traducir DTOs, orquestar el
 * repository y avisar por sockets.
 */
@Injectable()
export class MatchesService {
  constructor(
    @Inject(MATCHES_REPOSITORY)
    private readonly matchesRepository: IMatchesRepository,
    private readonly realtime: RealtimeService,
  ) {}

  private async getMatchOrFail(matchId: number): Promise<Match> {
    const match = await this.matchesRepository.findById(matchId);

    if (!match) {
      throw new NotFoundException({
        message: 'Match not found',
        errorCode: AppErrorCode.MATCH_NOT_FOUND,
      });
    }

    return match;
  }

  async search(params: SearchMatchDto): Promise<MatchResponseDto[]> {
    const matches = await this.matchesRepository.search(params);
    return MatchMapper.toResponseDtoList(matches);
  }

  async findOneById(matchId: number): Promise<MatchResponseDto> {
    const match = await this.getMatchOrFail(matchId);
    return MatchMapper.toResponseDto(match);
  }

  async create(dto: CreateMatchDto): Promise<MatchResponseDto> {
    const { match, lineup, notes } = MatchMapper.fromCreateDto(dto);

    const created = await this.matchesRepository.create(match, lineup, notes);
    const response = MatchMapper.toResponseDto(created);

    this.realtime.emit(RealtimeEvent.MATCH_CREATED, response);
    this.realtime.invalidateScoreboard(created.tournamentId);
    return response;
  }

  async update(matchId: number, dto: UpdateMatchDto): Promise<MatchResponseDto> {
    const { match, lineup, notes } = MatchMapper.fromUpdateDto(dto);

    const updated = await this.matchesRepository.update(matchId, match, lineup, notes);
    const response = MatchMapper.toResponseDto(updated);

    this.realtime.emit(RealtimeEvent.MATCH_UPDATED, response);
    this.realtime.invalidateScoreboard(updated.tournamentId);
    return response;
  }

  /**
   * Canchas ya usadas, para que el formulario las sugiera.
   *
   * No hay tabla de canchas: el lugar es texto libre en Matches. Crear una
   * entidad para esto obligaría a mantener un catálogo (altas, bajas, nombres
   * repetidos con distinta grafía) a cambio de nada — lo único que se necesita
   * es no tener que reescribir "LACONQUIJA" cada semana.
   */
  async findPlaces(): Promise<string[]> {
    return this.matchesRepository.findPlaces();
  }

  /**
   * Las notas del administrador, para precargar el formulario de edición.
   *
   * Van por su propio endpoint y no adentro del partido porque `findOneById`
   * es una lectura pública y estas notas no lo son: las escribe el admin para
   * que el diario tenga con qué contar la tarde, no para que las lea el grupo.
   * Es la misma decisión que el lore de los jugadores.
   */
  async findNotes(matchId: number): Promise<MatchNotesResponseDto> {
    return { notes: await this.matchesRepository.findNotes(matchId) };
  }

  async remove(matchId: number): Promise<MatchResponseDto> {
    const removed = await this.matchesRepository.remove(matchId);
    const response = MatchMapper.toResponseDto(removed);

    this.realtime.emit(RealtimeEvent.MATCH_DELETED, response);
    this.realtime.invalidateScoreboard(removed.tournamentId);
    return response;
  }
}
