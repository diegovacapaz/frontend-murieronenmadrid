import { Inject, Injectable, Logger } from '@nestjs/common';
import { esEntradaDuplicada } from '../../database/database.duplicates';
import { RealtimeEvent } from '../../realtime/realtime.events';
import { RealtimeService } from '../../realtime/realtime.service';
import { AlmacenDeBorradores } from './borradores';
import { DossierBuilder } from './dossier.builder';
import type { LastEdition } from './entities/edition.entity';
import { armarDatosEdicion } from './helpers/datos-edicion';
import { validarEdicion } from './helpers/edition.validator';
import { fechaDeHoy } from './helpers/fecha';
import { contarPartidosNuevos, extraerMaterial, type ParteDelMaterial } from './helpers/material';
import type { Dossier } from './interfaces/dossier';
import type { INewsletterRepository } from './interfaces/newsletter.repository.interface';
import { NewsletterMcpError } from './newsletter.errors';
import { NEWSLETTER_REPOSITORY } from './newsletter.constants';
import { construirSystemMcp } from './newsletter.prompt.mcp';
import { NewsletterService, yaHayEdicionDe } from './newsletter.service';


/**
 * Lo que `diario_iniciar` deja guardado hasta que `diario_publicar` lo consume.
 *
 * Es todo lo que hace falta para publicar SIN volver a leer el estado del mundo:
 * el dossier con el que se escribió (de ahí salen el snapshot y el puntero que se
 * guardan), contra qué foto se comparó, y si al publicar se inserta o se
 * reemplaza una fecha.
 */
export interface Borrador {
  dossier: Dossier;
  anterior: LastEdition | null;
  esInaugural: boolean;
  destino: { tipo: 'insertar' } | { tipo: 'reemplazar'; fecha: string };
}

/** Lo que recibe el redactor al empezar: lo chico, y cómo pedir lo grande. */
export interface Briefing {
  draftId: string;
  /** La fecha de los DATOS: hoy. */
  fecha: string;
  /**
   * La fecha que lleva la edición. Es `fecha` salvo que se esté regenerando otra:
   * ahí los datos son de hoy pero la edición sale con la fecha que se reescribe.
   */
  fechaEdicion: string;
  modo: 'nueva' | 'regeneracion';
  esInaugural: boolean;
  punteroAnterior: number | null;
  ultimoMatchId: number;
  partidosNuevos: number;
  aviso: string | null;
  jugadores: Array<{ playerId: number; displayName: string }>;
  contexto: {
    loreGrupo: string | null;
    lorePorJugador: Record<number, string>;
    titularesRecientes: string[];
  };
  manual: string;
  /** El tamaño de cada pieza que se pide con `diario_material`, para que el redactor se haga a la idea. */
  material: {
    historialChars: number;
    estadoChars: number;
    estadoAnteriorChars: number | null;
  };
}

const BORRADOR_PERDIDO =
  'El borrador no existe o ya venció (duran 3 horas). Llamá a diario_iniciar de nuevo para empezar otra vez.';

/**
 * Lo que hace el MCP del diario: armar el material, entregarlo y publicar.
 *
 * Reusa lo que ya hace la API —el dossier, la validación, el insert y el
 * puntero— y sólo cambia quién escribe: acá es un cliente MCP (claude.ai) y no
 * una llamada a la API de pago.
 *
 * ## La regla que ordena todo: se publica lo que el redactor vio
 *
 * El snapshot y el puntero que se guardan salen del BORRADOR, no de una lectura
 * nueva al publicar. Si entre `iniciar` y `publicar` entra un partido, el diario
 * no lo cuenta y el puntero tampoco lo marca: sale en la edición siguiente.
 * Recalcularlo al publicar daría el partido por contado sin que nadie lo haya
 * contado.
 *
 * Todo error de negocio sale como `NewsletterMcpError`, cuyo mensaje lee un
 * modelo: dice qué hacer y no arrastra detalles internos.
 */
@Injectable()
export class NewsletterMcpService {
  private readonly logger = new Logger(NewsletterMcpService.name);
  private readonly borradores = new AlmacenDeBorradores<Borrador>();

  constructor(
    @Inject(NEWSLETTER_REPOSITORY)
    private readonly repositorio: INewsletterRepository,
    private readonly newsletterService: NewsletterService,
    private readonly dossierBuilder: DossierBuilder,
    private readonly realtime: RealtimeService,
  ) {}

  /**
   * Arma el borrador y devuelve el manual y el briefing.
   *
   * Con `regenerarFecha` reescribe la edición de esa fecha; sin ella, escribe la
   * de hoy. **No rebota si no hay partidos nuevos**: igual que el botón de la
   * app, si quien lo pide quiere una edición es porque la quiere. Devuelve el
   * aviso y el manual le indica al redactor que lo consulte antes de publicar.
   */
  async iniciar(regenerarFecha?: string): Promise<Briefing> {
    const config = await this.repositorio.findConfig();
    if (!config.isEnabled) {
      throw new NewsletterMcpError(
        'MurieronNews está apagado en la configuración. Pedile al editor que lo prenda.',
      );
    }

    let anterior: LastEdition | null;
    let destino: Borrador['destino'];

    if (regenerarFecha) {
      const propia = await this.repositorio.findEditionOn(regenerarFecha);
      if (!propia) {
        throw new NewsletterMcpError(
          `No hay una edición del ${regenerarFecha} para regenerar. Revisá la fecha o llamá a diario_iniciar sin regenerarFecha.`,
        );
      }
      anterior = await this.newsletterService.resolverBaseDeRegeneracion(propia);
      destino = { tipo: 'reemplazar', fecha: regenerarFecha };
    } else {
      anterior = await this.repositorio.findLastEdition();
      const hoy = fechaDeHoy();
      if (yaHayEdicionDe(hoy, anterior)) {
        throw new NewsletterMcpError(
          `Ya existe la edición del ${hoy}. Para reescribirla, llamá a diario_iniciar con regenerarFecha: "${hoy}".`,
        );
      }
      destino = { tipo: 'insertar' };
    }

    const arranque = Date.now();
    const titulares = await this.repositorio.findRecentHeadlines();
    const dossier = await this.dossierBuilder.build(titulares);
    this.logger.log(`diario_iniciar: dossier armado en ${Date.now() - arranque} ms`);

    // El mismo criterio que usa NewsletterService.generar: lo que decide entre el
    // manual de "contá la diferencia" y el del número uno es si hay con qué
    // compararse, no si existió una edición.
    const esInaugural = anterior?.snapshot == null;

    const base = { dossier, anterior };
    const draftId = this.borradores.guardar({ ...base, esInaugural, destino });

    const punteroAnterior = anterior?.lastMatchId ?? null;
    const partidosNuevos = contarPartidosNuevos(dossier.historial, punteroAnterior);
    const modo = destino.tipo === 'insertar' ? 'nueva' : 'regeneracion';

    const fechaEdicion = destino.tipo === 'reemplazar' ? destino.fecha : dossier.contexto.fecha;

    return {
      draftId,
      fecha: dossier.contexto.fecha,
      fechaEdicion,
      modo,
      esInaugural,
      punteroAnterior,
      ultimoMatchId: dossier.contexto.ultimoMatchId,
      partidosNuevos,
      aviso: this.avisoDelBriefing(modo, partidosNuevos, anterior, fechaEdicion, dossier.contexto.fecha),
      jugadores: Object.entries(dossier.estado.jugadores).map(([playerId, jugador]) => ({
        playerId: Number(playerId),
        displayName: jugador.displayName,
      })),
      contexto: {
        loreGrupo: dossier.contexto.loreGrupo,
        lorePorJugador: dossier.contexto.lorePorJugador,
        titularesRecientes: dossier.contexto.titularesRecientes,
      },
      manual: construirSystemMcp(config, esInaugural),
      material: {
        historialChars: extraerMaterial(base, 'historial')?.length ?? 0,
        estadoChars: extraerMaterial(base, 'estado')?.length ?? 0,
        estadoAnteriorChars: extraerMaterial(base, 'estado_anterior')?.length ?? null,
      },
    };
  }

  /** Una pieza del material de un borrador, como texto JSON. */
  material(draftId: string, parte: ParteDelMaterial, desdeMatchId?: number): string {
    const borrador = this.borradores.obtener(draftId);
    if (!borrador) throw new NewsletterMcpError(BORRADOR_PERDIDO);

    const texto = extraerMaterial(borrador, parte, desdeMatchId);
    if (texto === null) {
      throw new NewsletterMcpError(
        'No hay una foto anterior con la que comparar: esta es la primera edición. ' +
          'Trabajá sobre el estado de hoy y el historial.',
      );
    }
    return texto;
  }

  /**
   * Valida y publica. Si la edición es inválida, el motivo vuelve como error y el
   * borrador sigue vivo para corregir y reintentar.
   */
  async publicar(
    draftId: string,
    notas: unknown,
  ): Promise<{ editionNumber: number; publishedOn: string; notas: number }> {
    const borrador = this.borradores.obtener(draftId);
    if (!borrador) throw new NewsletterMcpError(BORRADOR_PERDIDO);

    const playerIds = new Set(Object.keys(borrador.dossier.estado.jugadores).map(Number));
    const validada = validarEdicion({ notas }, playerIds);
    if (!validada.ok) {
      throw new NewsletterMcpError(
        `La edición no se publicó: ${validada.motivo}. ` +
          'Corregí eso y volvé a llamar a diario_publicar con todas las notas.',
      );
    }

    // El validador tira o recorta cosas en silencio para que la API publique igual
    // (ahí hay un solo intento pago). Acá el reintento es gratis, así que se
    // rechaza y se le dice qué se perdería: publicar "con éxito" una portada sin
    // su héroe, o sin una nota, sin que el redactor se entere, es peor que pedirle
    // que lo corrija.
    if (validada.descartes.length > 0) {
      throw new NewsletterMcpError(
        'La edición no se publicó porque se perdería parte de lo que mandaste:\n' +
          validada.descartes.map((descarte) => `- ${descarte}`).join('\n') +
          '\nCorregí eso y volvé a llamar a diario_publicar con todas las notas.',
      );
    }

    const fecha = borrador.dossier.contexto.fecha;

    // Un SELECT barato ANTES del INSERT, para dar un mensaje claro cuando otra
    // conversación ya publicó esta fecha. El UNIQUE de la base sigue siendo la
    // red de seguridad real (ver más abajo).
    if (borrador.destino.tipo === 'insertar') {
      const ultima = await this.repositorio.findLastEdition();
      if (yaHayEdicionDe(fecha, ultima)) {
        this.borradores.descartar(draftId);
        throw new NewsletterMcpError(this.mensajeDeFechaTomada(fecha));
      }
    }

    const datos = armarDatosEdicion(fecha, borrador.dossier, validada.notas, {
      model: 'claude-mcp',
      inputTokens: 0,
      outputTokens: 0,
    });

    let edicion;
    try {
      edicion =
        borrador.destino.tipo === 'insertar'
          ? await this.repositorio.insertEdition(datos)
          : await this.repositorio.replaceEdition(borrador.destino.fecha, datos);
    } catch (error) {
      if (esEntradaDuplicada(error)) {
        // Reintentar fallaría igual: la fecha ya está tomada.
        this.borradores.descartar(draftId);
        throw new NewsletterMcpError(this.mensajeDeFechaTomada(fecha));
      }

      // Cualquier otro error de base: se loguea el real y el modelo recibe uno
      // genérico. El borrador sigue vivo, así que se puede reintentar.
      this.logger.error(
        `diario_publicar falló al guardar: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new NewsletterMcpError(
        'No se pudo guardar la edición por un error del servidor. ' +
          'El borrador sigue vivo: probá volver a llamar a diario_publicar.',
      );
    }

    this.borradores.descartar(draftId);
    this.realtime.emit(RealtimeEvent.NEWSLETTER_PUBLISHED, { publishedOn: edicion.publishedOn });
    this.logger.log(
      `MurieronNews Nº ${edicion.editionNumber} del ${edicion.publishedOn} publicada por MCP: ` +
        `${edicion.articles.length} notas, puntero en el matchId ${datos.lastMatchId}`,
    );

    return {
      editionNumber: edicion.editionNumber,
      publishedOn: edicion.publishedOn,
      notas: edicion.articles.length,
    };
  }

  private mensajeDeFechaTomada(fecha: string): string {
    return (
      `Otra conversación ya publicó la edición del ${fecha}. Este borrador se descartó: ` +
      `llamá a diario_iniciar de nuevo, o con regenerarFecha: "${fecha}" para reescribirla.`
    );
  }

  /**
   * El único aviso que lleva el briefing. En una regeneración de OTRA fecha, avisa
   * que los datos son de hoy pero la edición sale con la fecha reescrita: sin eso
   * el redactor tiende a escribir "hoy" como si el día de la edición fuera hoy. En
   * una edición nueva, avisa cuando no hay partidos nuevos.
   */
  private avisoDelBriefing(
    modo: 'nueva' | 'regeneracion',
    partidosNuevos: number,
    anterior: LastEdition | null,
    fechaEdicion: string,
    fechaDeLosDatos: string,
  ): string | null {
    if (modo === 'regeneracion') {
      return fechaEdicion === fechaDeLosDatos
        ? null
        : `Estás reescribiendo la edición del ${fechaEdicion}. Los datos que ves son los de ` +
            `hoy (${fechaDeLosDatos}), pero la edición lleva la fecha ${fechaEdicion}: no ` +
            `escribas "hoy" ni "ayer" como si el día de la edición fuera ${fechaDeLosDatos}.`;
    }

    if (partidosNuevos > 0) return null;

    return anterior
      ? `No hay partidos nuevos desde la edición Nº ${anterior.editionNumber} (puntero en el ` +
          `matchId ${anterior.lastMatchId}). Avisale al editor antes de publicar.`
      : 'No hay ningún partido cargado. Avisale al editor antes de publicar.';
  }
}
