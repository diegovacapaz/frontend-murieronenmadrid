import { Inject, Injectable, Logger } from '@nestjs/common';
import { esEntradaDuplicada } from '../../database/database.duplicates';
import { RealtimeEvent } from '../../realtime/realtime.events';
import { RealtimeService } from '../../realtime/realtime.service';
import { AlmacenDeBorradores } from '../newsletter/borradores';
import { DossierBuilder } from '../newsletter/dossier.builder';
import type { Dossier } from '../newsletter/interfaces/dossier';
import { NewsletterService } from '../newsletter/newsletter.service';
import type { BaseDelBorrador, VersionRanking } from './entities/powerade.entity';
import { decidirPublicacion } from './helpers/publicacion';
import { validarTop3 } from './helpers/top3.validator';
import type { IPoweradeRepository } from './interfaces/powerade.repository.interface';
import { MODELO_MCP, POWERADE_REPOSITORY, PUESTOS } from './powerade.constants';
import { PoweradeConflictoError, PoweradeMcpError } from './powerade.errors';
import { construirSystemPowerade } from './powerade.prompt';

/**
 * Lo que `powerade_iniciar` deja guardado hasta que `powerade_publicar` lo consume.
 *
 * `base` es la versión vigente SOBRE LA QUE SE ESCRIBIÓ (o ninguna) y
 * `lastMatchId` el máximo del torneo que el redactor tuvo delante. Con eso se
 * publica sin volver a leer el estado del mundo: lo que se guarda es lo que vio.
 */
export interface BorradorPowerade {
  tournamentId: number;
  tournamentName: string;
  dossier: Dossier;
  tabla: unknown[];
  participantes: Array<{ playerId: number; displayName: string; partidos: number }>;
  base: BaseDelBorrador;
  lastMatchId: number;
}

/** Una versión del ranking tal como la lee el redactor. */
export interface VersionParaElRedactor {
  version: number;
  lastMatchId: number;
  puestos: Array<{ position: number; playerId: number; displayName: string; razon: string }>;
}

export interface BriefingPowerade {
  draftId: string;
  torneo: { tournamentId: number; nombre: string; partidosJugados: number };
  /** La BASE de las flechas: contra ella se compara la versión que se publique. */
  versionAnterior: VersionParaElRedactor | null;
  /** La que se va a descartar cuando publicar REEMPLAZA en vez de agregar. */
  versionAReemplazar: VersionParaElRedactor | null;
  partidosNuevos: number;
  aviso: string | null;
  participantes: BorradorPowerade['participantes'];
  contexto: { loreGrupo: string | null; lorePorJugador: Record<number, string> };
  manual: string;
  /** El tamaño de cada pieza que se pide con `powerade_material`. */
  material: { torneoChars: number; jugadoresChars: number; historialChars: number };
}

export type ParteDelPowerade = 'torneo' | 'jugadores' | 'historial';

const BORRADOR_PERDIDO =
  'El borrador no existe, ya venció (duran 3 horas) o se abrieron otros borradores después. ' +
  'Llamá a powerade_iniciar de nuevo para empezar otra vez.';

/**
 * Lo que hace el MCP del Powerade: armar el material, entregarlo y publicar el
 * top 3 que escribe un cliente MCP.
 *
 * Reusa el `DossierBuilder`, el almacén de borradores y el manual de tono del
 * diario. Todo error de negocio sale como `PoweradeMcpError`, cuyo mensaje lee un
 * modelo: dice qué hacer y no arrastra detalles internos.
 */
@Injectable()
export class PoweradeMcpService {
  private readonly logger = new Logger(PoweradeMcpService.name);
  private readonly borradores = new AlmacenDeBorradores<BorradorPowerade>();

  /**
   * Los borradores que se están publicando ahora mismo.
   *
   * Un cliente MCP puede llamar dos veces a `powerade_publicar` con el mismo
   * `draftId` (un reintento tras una respuesta lenta, o el modelo que insiste): sin
   * esto las dos pasarían `obtener` y las dos publicarían, creando dos versiones
   * idénticas que dejarían las flechas en "=" con una frase que dice "subió". Se
   * marca de forma SINCRÓNICA, antes del primer `await`.
   */
  private readonly publicando = new Set<string>();

  constructor(
    @Inject(POWERADE_REPOSITORY)
    private readonly repositorio: IPoweradeRepository,
    private readonly newsletterService: NewsletterService,
    private readonly dossierBuilder: DossierBuilder,
    private readonly realtime: RealtimeService,
  ) {}

  /**
   * Arma el borrador y devuelve el manual y el briefing.
   *
   * **No rebota si no hay partidos nuevos**, igual que el diario: si alguien pide
   * un ranking es porque lo quiere. Devuelve el aviso, y publicar va a REEMPLAZAR
   * la versión vigente en vez de agregar otra.
   */
  async iniciar(tournamentId?: number): Promise<BriefingPowerade> {
    const id = tournamentId ?? (await this.repositorio.findPlayingTournamentId());
    if (id === null) {
      throw new PoweradeMcpError(
        'No hay ningún torneo en juego con detalle de partidos: el Powerade se arma sobre un torneo en juego.',
      );
    }

    const torneo = await this.repositorio.findTournament(id);
    if (!torneo) throw new PoweradeMcpError(`El torneo ${id} no existe.`);
    if (torneo.state !== 'P') {
      throw new PoweradeMcpError(`El torneo "${torneo.name}" no está en juego: el Powerade sólo se arma sobre un torneo en juego.`);
    }
    if (!torneo.wasTracked) {
      throw new PoweradeMcpError(
        `El torneo "${torneo.name}" no tiene detalle de partidos (sólo se conserva su tabla): no hay con qué juzgar.`,
      );
    }

    const participantes = await this.repositorio.findParticipants(id);
    if (participantes.length < PUESTOS) {
      throw new PoweradeMcpError(
        `Hacen falta al menos tres jugadores que hayan jugado el torneo y hay ${participantes.length}.`,
      );
    }

    // La versión vigente es la BASE: sobre ella se escribe y contra ella se
    // comprueba, al publicar, que nadie haya publicado en el medio.
    const versiones = await this.repositorio.findLatestVersions(id, 2);
    const vigente = versiones[0] ?? null;
    const base: BaseDelBorrador = vigente
      ? {
          rankingId: vigente.rankingId,
          version: vigente.version,
          lastMatchId: vigente.lastMatchId,
          revision: vigente.revision,
        }
      : null;

    // EL PUNTERO SE LEE ANTES DE ARMAR EL MATERIAL. Si se leyera después, un
    // partido cargado entre las dos cosas quedaría marcado como contado sin que el
    // redactor lo haya visto. Al revés, lo peor que pasa es que el siguiente
    // ranking cuente como nuevo un partido que ya vio: inofensivo.
    const lastMatchId = (await this.repositorio.findMaxMatchId(id)) ?? 0;

    const config = await this.newsletterService.findConfig();
    const dossier = await this.dossierBuilder.build([], { tournamentId: id });
    const tabla = await this.repositorio.findTournamentTable(id);

    const borrador: BorradorPowerade = {
      tournamentId: id,
      tournamentName: torneo.name,
      dossier,
      tabla,
      participantes,
      base,
      lastMatchId,
    };
    const draftId = this.borradores.guardar(borrador);

    // Se predice el destino con la misma regla que se aplica al publicar: es lo que
    // decide cuál versión es la base de las flechas y cuál se va a descartar.
    const reemplaza = decidirPublicacion(base, lastMatchId, base) === 'reemplazar';
    const { nuevos } = await this.repositorio.countMatches(id, base?.lastMatchId ?? 0);
    const { contados } = await this.repositorio.countMatches(id, lastMatchId);

    return {
      draftId,
      torneo: { tournamentId: id, nombre: torneo.name, partidosJugados: contados },
      versionAnterior: this.paraElRedactor(reemplaza ? (versiones[1] ?? null) : vigente),
      versionAReemplazar: reemplaza ? this.paraElRedactor(vigente) : null,
      partidosNuevos: nuevos,
      aviso:
        base && nuevos === 0
          ? `No hay partidos nuevos desde la versión ${base.version} (puntero en el matchId ` +
            `${base.lastMatchId}). Si publicás, se REEMPLAZA esa versión en lugar de agregar otra.`
          : null,
      participantes,
      contexto: {
        loreGrupo: dossier.contexto.loreGrupo,
        lorePorJugador: dossier.contexto.lorePorJugador,
      },
      manual: construirSystemPowerade(config, torneo.name),
      material: {
        torneoChars: this.extraer(borrador, 'torneo').length,
        jugadoresChars: this.extraer(borrador, 'jugadores').length,
        historialChars: this.extraer(borrador, 'historial').length,
      },
    };
  }

  /** Una pieza del material de un borrador, como texto JSON. */
  material(draftId: string, parte: ParteDelPowerade, desdeMatchId?: number): string {
    const borrador = this.borradores.obtener(draftId);
    if (!borrador) throw new PoweradeMcpError(BORRADOR_PERDIDO);

    return this.extraer(borrador, parte, desdeMatchId);
  }

  /**
   * Valida y publica. Si el top 3 es inválido, los problemas vuelven como error y
   * el borrador sigue vivo para corregir y reintentar.
   */
  async publicar(
    draftId: string,
    top3: unknown,
  ): Promise<{ tournamentId: number; version: number; accion: 'nueva' | 'reemplazada' }> {
    const borrador = this.borradores.obtener(draftId);
    if (!borrador) throw new PoweradeMcpError(BORRADOR_PERDIDO);

    if (this.publicando.has(draftId)) {
      throw new PoweradeMcpError(
        'Este borrador ya se está publicando (llamaste a powerade_publicar dos veces a la vez). ' +
          'Esperá el resultado de la primera llamada.',
      );
    }
    this.publicando.add(draftId);

    try {
      return await this.publicarBorrador(draftId, borrador, top3);
    } finally {
      this.publicando.delete(draftId);
    }
  }

  private async publicarBorrador(
    draftId: string,
    borrador: BorradorPowerade,
    top3: unknown,
  ): Promise<{ tournamentId: number; version: number; accion: 'nueva' | 'reemplazada' }> {
    const { tournamentId } = borrador;

    const torneo = await this.repositorio.findTournament(tournamentId);
    if (!torneo || torneo.state !== 'P') {
      this.borradores.descartar(draftId);
      throw new PoweradeMcpError(
        'El torneo ya no está en juego (terminó mientras escribías): no se publica el ranking. ' +
          'Este borrador se descartó.',
      );
    }

    const validado = validarTop3(top3, new Set(borrador.participantes.map((p) => p.playerId)));
    if (!validado.ok) {
      throw new PoweradeMcpError(
        'El ranking no se publicó:\n' +
          validado.problemas.map((problema) => `- ${problema}`).join('\n') +
          '\nCorregí eso y volvé a llamar a powerade_publicar con los tres jugadores.',
      );
    }

    // Se vuelve a leer la vigente y se compara con la base del borrador: si no es
    // exactamente la misma, otra conversación publicó en el medio.
    const [vigenteAhora] = await this.repositorio.findLatestVersions(tournamentId, 1);
    const accion = decidirPublicacion(borrador.base, borrador.lastMatchId, this.comoBase(vigenteAhora));

    if (accion === 'conflicto') {
      this.borradores.descartar(draftId);
      throw new PoweradeMcpError(this.mensajeDeConflicto());
    }

    const datos = {
      tournamentId,
      lastMatchId: borrador.lastMatchId,
      model: MODELO_MCP,
      entradas: validado.entradas,
    };

    let publicada: VersionRanking;
    try {
      publicada =
        accion === 'insertar' || !vigenteAhora
          ? await this.repositorio.insertRanking(
              datos,
              borrador.base
                ? { rankingId: borrador.base.rankingId, revision: borrador.base.revision }
                : null,
            )
          : await this.repositorio.replaceRanking(
              { rankingId: vigenteAhora.rankingId, revision: vigenteAhora.revision },
              datos,
            );
    } catch (error) {
      if (error instanceof PoweradeConflictoError || esEntradaDuplicada(error)) {
        // Reintentar fallaría igual: otra conversación ganó la carrera.
        this.borradores.descartar(draftId);
        throw new PoweradeMcpError(this.mensajeDeConflicto());
      }

      // Cualquier otro error de base: se loguea el real y el modelo recibe uno
      // genérico. El borrador sigue vivo, así que se puede reintentar.
      this.logger.error(
        `powerade_publicar falló al guardar: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new PoweradeMcpError(
        'No se pudo guardar el ranking por un error del servidor. ' +
          'El borrador sigue vivo: probá volver a llamar a powerade_publicar.',
      );
    }

    this.borradores.descartar(draftId);
    this.realtime.emit(RealtimeEvent.POWERADE_PUBLISHED, { tournamentId });
    this.logger.log(
      `Powerade del torneo ${tournamentId}: versión ${publicada.version} ` +
        `${accion === 'insertar' ? 'nueva' : 'reemplazada'}, puntero en el matchId ${borrador.lastMatchId}`,
    );

    return {
      tournamentId,
      version: publicada.version,
      accion: accion === 'insertar' ? 'nueva' : 'reemplazada',
    };
  }

  // ─── Auxiliares ─────────────────────────────────────────────────────────────

  private extraer(borrador: BorradorPowerade, parte: ParteDelPowerade, desdeMatchId?: number): string {
    const { dossier } = borrador;

    switch (parte) {
      case 'torneo':
        return JSON.stringify({ tabla: borrador.tabla, estadisticas: dossier.estado.torneoActivo });
      case 'jugadores': {
        // Sólo quienes jugaron el torneo: el resto del padrón no aporta y es peso.
        const jugaron = new Set(borrador.participantes.map((p) => p.playerId));
        const jugadores = Object.fromEntries(
          Object.entries(dossier.estado.jugadores).filter(([playerId]) => jugaron.has(Number(playerId))),
        );
        return JSON.stringify({ jugadores, catalogoLogros: dossier.estado.catalogoLogros });
      }
      case 'historial':
        return JSON.stringify(
          desdeMatchId === undefined
            ? dossier.historial
            : dossier.historial.filter((partido) => partido.matchId > desdeMatchId),
        );
    }
  }

  private paraElRedactor(version: VersionRanking | null): VersionParaElRedactor | null {
    if (!version) return null;

    return {
      version: version.version,
      lastMatchId: version.lastMatchId,
      puestos: version.entries.map((entrada) => ({
        position: entrada.position,
        playerId: entrada.playerId,
        displayName: entrada.displayName,
        razon: entrada.reason,
      })),
    };
  }

  private comoBase(version: VersionRanking | undefined): BaseDelBorrador {
    return version
      ? {
          rankingId: version.rankingId,
          version: version.version,
          lastMatchId: version.lastMatchId,
          revision: version.revision,
        }
      : null;
  }

  private mensajeDeConflicto(): string {
    return (
      'Otra conversación publicó el ranking de este torneo mientras escribías. ' +
      'Este borrador se descartó: llamá a powerade_iniciar de nuevo.'
    );
  }
}
