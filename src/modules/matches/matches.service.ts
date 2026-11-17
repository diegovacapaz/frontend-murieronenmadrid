import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AppErrorCode } from '../../common/constants/error-codes.constants';
import { RealtimeEvent } from '../../realtime/realtime.events';
import { RealtimeService } from '../../realtime/realtime.service';
import { CreateMatchDto } from './dto/create-match.dto';
import { FinishMatchDto } from './dto/finish-match.dto';
import { MatchNotesResponseDto } from './dto/match-notes.dto';
import { MatchResponseDto } from './dto/match-response.dto';
import { SearchMatchDto } from './dto/search-match.dto';
import { SetTeamsDto } from './dto/set-teams.dto';
import { UpdateMatchDto } from './dto/update-match.dto';
import { Match } from './entities/match.entity';
import { MatchState } from './enums/match-state.enum';
import { MatchMapper } from './helpers/match.mapper';
import type { IMatchesRepository } from './interfaces/matches.repository.interface';
import { MATCHES_REPOSITORY } from './matches.constants';

/**
 * Las reglas duras de un partido (torneo en juego, coherencia entre ganador y
 * diferencia, equipos que corresponden al tipo de partido, jugadores activos y
 * sin repetir, transiciones de estado) viven en los stored procedures.
 *
 * No es pereza: son controles que necesitan mirar varias tablas a la vez y
 * dentro de la misma transaccion que hace el INSERT. Validarlos tambien aca
 * seria duplicar logica que un dia va a divergir, y ademas dejaria una ventana
 * de carrera entre el chequeo y la escritura.
 *
 * Lo que si es responsabilidad de este service: traducir DTOs, orquestar el
 * repository, decidir que ve quien (un partido en preparacion es solo para
 * admins) y avisar por sockets.
 */
@Injectable()
export class MatchesService {
  constructor(
    @Inject(MATCHES_REPOSITORY)
    private readonly matchesRepository: IMatchesRepository,
    private readonly realtime: RealtimeService,
  ) {}

  private async getMatchOrFail(matchId: number, isAdmin: boolean): Promise<Match> {
    const match = await this.matchesRepository.findById(matchId);

    // Un partido en preparacion no existe para quien no es admin: responder
    // 404 y no 403 evita confirmar que hay algo ahi.
    if (!match || (match.state === MatchState.PREPARING && !isAdmin)) {
      throw new NotFoundException({
        message: 'Match not found',
        errorCode: AppErrorCode.MATCH_NOT_FOUND,
      });
    }

    return match;
  }

  async search(params: SearchMatchDto, isAdmin: boolean): Promise<MatchResponseDto[]> {
    const matches = await this.matchesRepository.search({
      ...params,
      includePending: isAdmin && params.includePending === true,
    });
    return MatchMapper.toResponseDtoList(matches);
  }

  async findOneById(matchId: number, isAdmin: boolean): Promise<MatchResponseDto> {
    const match = await this.getMatchOrFail(matchId, isAdmin);
    return MatchMapper.toResponseDto(match);
  }

  /** Lo que alimenta la card de la portada: listos y armados en vivo. */
  async findUpcoming(): Promise<MatchResponseDto[]> {
    return MatchMapper.toResponseDtoList(await this.matchesRepository.findUpcoming());
  }

  async create(dto: CreateMatchDto): Promise<MatchResponseDto> {
    const { match, lineup, guests, notes } = MatchMapper.fromCreateDto(dto);

    const created = await this.matchesRepository.create(match, lineup, guests, notes);
    const response = MatchMapper.toResponseDto(created);

    this.notify(RealtimeEvent.MATCH_CREATED, response);
    return response;
  }

  async update(matchId: number, dto: UpdateMatchDto): Promise<MatchResponseDto> {
    const { match, lineup, guests, notes } = MatchMapper.fromUpdateDto(dto);

    const updated = await this.matchesRepository.update(matchId, match, lineup, guests, notes);
    const response = MatchMapper.toResponseDto(updated);

    this.notify(RealtimeEvent.MATCH_UPDATED, response);
    return response;
  }

  /** Armar equipos a mano: en preparacion -> listo. */
  async setTeams(matchId: number, dto: SetTeamsDto): Promise<MatchResponseDto> {
    const { lineup, guests } = MatchMapper.fromSetTeamsDto(dto);
    const response = MatchMapper.toResponseDto(
      await this.matchesRepository.setTeams(matchId, lineup, guests),
    );
    this.notify(RealtimeEvent.MATCH_UPDATED, response);
    return response;
  }

  /** Deshacer equipos: listo -> en preparacion. */
  async clearTeams(matchId: number): Promise<MatchResponseDto> {
    const response = MatchMapper.toResponseDto(await this.matchesRepository.clearTeams(matchId));
    this.notify(RealtimeEvent.MATCH_UPDATED, response);
    return response;
  }

  /** Cargar el resultado: listo -> jugado. Desde aca el partido cuenta. */
  async finish(matchId: number, dto: FinishMatchDto): Promise<MatchResponseDto> {
    const response = MatchMapper.toResponseDto(
      await this.matchesRepository.finish(matchId, MatchMapper.fromFinishDto(dto)),
    );
    this.notify(RealtimeEvent.MATCH_UPDATED, response);
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

    this.notify(RealtimeEvent.MATCH_DELETED, response);
    return response;
  }

  /**
   * Avisa por socket. El canal es publico, asi que un partido en preparacion
   * viaja sin datos (solo su id): el frontend refetchea y, si no es admin, no
   * lo ve. Solo un partido jugado mueve las tablas.
   */
  private notify(event: RealtimeEvent, match: MatchResponseDto): void {
    const payload =
      match.state === MatchState.PREPARING
        ? { matchId: match.matchId, tournamentId: match.tournamentId, state: match.state }
        : match;
    this.realtime.emit(event, payload);
    if (match.state === MatchState.PLAYED) {
      this.realtime.invalidateScoreboard(match.tournamentId);
    }
  }
}
