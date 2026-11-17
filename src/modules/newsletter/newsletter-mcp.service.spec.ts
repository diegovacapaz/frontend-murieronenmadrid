import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { NativeErrorCode } from '../../database/database.errors';
import type { LastEdition } from './entities/edition.entity';
import { fechaDeHoy } from './helpers/fecha';
import type { Dossier } from './interfaces/dossier';
import { NewsletterMcpError } from './newsletter.errors';
import { NewsletterMcpService } from './newsletter-mcp.service';
import { RealtimeEvent } from '../../realtime/realtime.events';

const config = { paperName: 'MurieronNews', groupLore: null, styleGuide: null, isEnabled: true };

/** Un dossier mínimo: `matchIds` son los partidos del historial. */
function dossierDe(matchIds: number[], marca = 'A'): Dossier {
  return {
    estado: {
      version: 1,
      general: { marca },
      torneoActivo: null,
      mundialito: {},
      catalogoLogros: [],
      jugadores: { 1: { displayName: 'Nacho' }, 2: { displayName: 'Fede' } },
    },
    historial: matchIds.map((matchId) => ({ matchId })),
    contexto: {
      fecha: '2026-11-17',
      ultimoMatchId: Math.max(0, ...matchIds),
      titularesRecientes: ['Cayó el invicto'],
      loreGrupo: 'lore',
      lorePorJugador: { 1: 'es del Real' },
    },
  } as unknown as Dossier;
}

function edicion(parcial: Partial<LastEdition> = {}): LastEdition {
  return {
    editionId: 1,
    editionNumber: 7,
    publishedOn: '2026-11-10',
    lastMatchId: 3,
    snapshotVersion: 1,
    snapshot: { version: 1, general: { marca: 'ANTERIOR' } } as never,
    ...parcial,
  };
}

const notasValidas = [
  {
    seccion: 'PORTADA',
    titular: 'Titular',
    copete: 'Copete',
    cuerpo: 'Cuerpo de la nota.',
    jugadores: [{ playerId: 1, rol: 'HEROE' }],
  },
];

function armar(
  opciones: {
    anterior?: LastEdition | null;
    propia?: LastEdition | null;
    base?: LastEdition | null;
    config?: typeof config;
    dossier?: Dossier;
  } = {},
) {
  const dossierInicial = opciones.dossier ?? dossierDe([1, 2, 3, 4, 5]);
  const repo = {
    findConfig: vi.fn().mockResolvedValue(opciones.config ?? config),
    findLastEdition: vi.fn().mockResolvedValue(
      opciones.anterior === undefined ? edicion() : opciones.anterior,
    ),
    findEditionOn: vi.fn().mockResolvedValue(opciones.propia ?? null),
    findRecentHeadlines: vi.fn().mockResolvedValue(['Cayó el invicto']),
    insertEdition: vi
      .fn()
      .mockResolvedValue({ editionNumber: 8, publishedOn: '2026-11-17', publishedAt: '', articles: [{}] }),
    replaceEdition: vi
      .fn()
      .mockResolvedValue({ editionNumber: 7, publishedOn: '2026-11-10', publishedAt: '', articles: [{}] }),
  };
  const builder = { build: vi.fn().mockResolvedValue(dossierInicial) };
  const newsletterService = {
    resolverBaseDeRegeneracion: vi.fn().mockResolvedValue(opciones.base ?? null),
  };
  const realtime = { emit: vi.fn() };
  const servicio = new NewsletterMcpService(
    repo as never,
    newsletterService as never,
    builder as never,
    realtime as never,
  );
  return { servicio, repo, builder, newsletterService, realtime };
}

describe('NewsletterMcpService.iniciar', () => {
  it('crea un borrador y devuelve su draftId, la fecha y el manual', async () => {
    const { servicio } = armar();
    const briefing = await servicio.iniciar();

    expect(briefing.draftId).toEqual(expect.any(String));
    expect(briefing.fecha).toBe('2026-11-17');
    expect(briefing.modo).toBe('nueva');
    expect(briefing.manual).toContain('diario_publicar');
    expect(briefing.manual).toContain('MurieronNews');
  });

  it('cuenta los partidos nuevos desde el puntero de la edición anterior', async () => {
    const { servicio } = armar({ anterior: edicion({ lastMatchId: 3 }) });
    const briefing = await servicio.iniciar();

    expect(briefing.punteroAnterior).toBe(3);
    expect(briefing.partidosNuevos).toBe(2);
    expect(briefing.aviso).toBeNull();
  });

  it('sin partidos nuevos NO rebota: devuelve partidosNuevos 0 y un aviso', async () => {
    const { servicio } = armar({ anterior: edicion({ lastMatchId: 5 }) });
    const briefing = await servicio.iniciar();

    expect(briefing.partidosNuevos).toBe(0);
    expect(briefing.aviso).toEqual(expect.stringContaining('No hay partidos nuevos'));
  });

  it('FECHA DE LA EDICIÓN: en una edición nueva es la de hoy y no hay aviso de fecha', async () => {
    const { servicio } = armar({ anterior: edicion({ lastMatchId: 3 }) });
    const briefing = await servicio.iniciar();

    expect(briefing.fechaEdicion).toBe('2026-11-17');
    expect(briefing.aviso).toBeNull();
  });

  it('FECHA DE LA EDICIÓN: al regenerar otra fecha, el briefing dice con qué fecha sale y avisa', async () => {
    const propia = edicion({ publishedOn: '2026-11-10', lastMatchId: 5 });
    const { servicio } = armar({ propia, base: edicion({ lastMatchId: 2 }) });
    const briefing = await servicio.iniciar('2026-11-10');

    // `fecha` es la de los DATOS (hoy); `fechaEdicion`, la que lleva la edición.
    expect(briefing.fecha).toBe('2026-11-17');
    expect(briefing.fechaEdicion).toBe('2026-11-10');
    expect(briefing.aviso).toContain('2026-11-10');
    expect(briefing.aviso).toContain('2026-11-17');
  });

  it('FECHA DE LA EDICIÓN: regenerar la de hoy no necesita aviso de fecha', async () => {
    const propia = edicion({ publishedOn: '2026-11-17', lastMatchId: 5 });
    const { servicio } = armar({ propia, base: edicion({ lastMatchId: 2 }) });
    const briefing = await servicio.iniciar('2026-11-17');

    expect(briefing.fechaEdicion).toBe('2026-11-17');
    expect(briefing.aviso).toBeNull();
  });

  it('es inaugural cuando no hay edición anterior', async () => {
    const { servicio } = armar({ anterior: null });
    const briefing = await servicio.iniciar();

    expect(briefing.esInaugural).toBe(true);
    expect(briefing.punteroAnterior).toBeNull();
    expect(briefing.manual).toContain('NÚMERO UNO');
  });

  it('es inaugural cuando la edición anterior no tiene snapshot', async () => {
    const { servicio } = armar({ anterior: edicion({ snapshot: null }) });

    expect((await servicio.iniciar()).esInaugural).toBe(true);
  });

  it('lista los jugadores y trae el contexto', async () => {
    const { servicio } = armar();
    const briefing = await servicio.iniciar();

    expect(briefing.jugadores).toEqual([
      { playerId: 1, displayName: 'Nacho' },
      { playerId: 2, displayName: 'Fede' },
    ]);
    expect(briefing.contexto.loreGrupo).toBe('lore');
    expect(briefing.contexto.titularesRecientes).toEqual(['Cayó el invicto']);
  });

  it('informa el tamaño de cada pieza del material', async () => {
    const { servicio } = armar();
    const { material } = await servicio.iniciar();

    expect(material.historialChars).toBeGreaterThan(0);
    expect(material.estadoChars).toBeGreaterThan(0);
    expect(material.estadoAnteriorChars).toBeGreaterThan(0);
  });

  it('rebota si el diario está apagado en la configuración', async () => {
    const { servicio } = armar({ config: { ...config, isEnabled: false } });

    await expect(servicio.iniciar()).rejects.toBeInstanceOf(NewsletterMcpError);
  });

  it('rebota si ya existe la edición de hoy y dice cómo reescribirla', async () => {
    const { servicio, builder } = armar({ anterior: edicion({ publishedOn: fechaDeHoy() }) });

    await expect(servicio.iniciar()).rejects.toThrow(/regenerarFecha/);
    expect(builder.build).not.toHaveBeenCalled();
  });

  it('regenerarFecha inexistente rebota', async () => {
    const { servicio } = armar({ propia: null });

    await expect(servicio.iniciar('2026-01-01')).rejects.toBeInstanceOf(NewsletterMcpError);
  });

  it('regenerarFecha existente usa la base de resolverBaseDeRegeneracion y deja destino reemplazar', async () => {
    const propia = edicion({ publishedOn: '2026-11-10', lastMatchId: 5 });
    const base = edicion({ editionNumber: 6, lastMatchId: 2 });
    const { servicio, newsletterService, repo } = armar({ propia, base });

    const briefing = await servicio.iniciar('2026-11-10');
    expect(newsletterService.resolverBaseDeRegeneracion).toHaveBeenCalledWith(propia);
    expect(briefing.modo).toBe('regeneracion');
    expect(briefing.punteroAnterior).toBe(2);

    // Y publicar reemplaza esa fecha, no inserta.
    await servicio.publicar(briefing.draftId, notasValidas);
    expect(repo.replaceEdition).toHaveBeenCalledWith('2026-11-10', expect.anything());
    expect(repo.insertEdition).not.toHaveBeenCalled();
  });
});

describe('NewsletterMcpService.material', () => {
  it('un draftId desconocido da un error que manda a llamar a diario_iniciar', () => {
    const { servicio } = armar();

    expect(() => servicio.material('no-existe', 'estado')).toThrow(/diario_iniciar/);
  });

  it('estado_anterior sin snapshot previo da un error claro', async () => {
    const { servicio } = armar({ anterior: null });
    const { draftId } = await servicio.iniciar();

    expect(() => servicio.material(draftId, 'estado_anterior')).toThrow(NewsletterMcpError);
  });

  it('historial con desdeMatchId filtra', async () => {
    const { servicio } = armar();
    const { draftId } = await servicio.iniciar();

    const texto = servicio.material(draftId, 'historial', 3);
    expect((JSON.parse(texto) as Array<{ matchId: number }>).map((p) => p.matchId)).toEqual([4, 5]);
  });
});

describe('NewsletterMcpService.publicar', () => {
  it('SNAPSHOT CONGELADO: publica el snapshot y el puntero del borrador, no los de ahora', async () => {
    const { servicio, builder, repo } = armar({ dossier: dossierDe([1, 2, 3, 4, 5], 'A') });
    const { draftId } = await servicio.iniciar();

    // Entre iniciar y publicar entró un partido y el estado cambió.
    builder.build.mockResolvedValue(dossierDe([1, 2, 3, 4, 5, 6], 'B'));

    await servicio.publicar(draftId, notasValidas);

    const datos = repo.insertEdition.mock.calls[0][0] as {
      snapshot: { general: { marca: string } };
      lastMatchId: number;
    };
    expect(datos.snapshot.general.marca).toBe('A');
    expect(datos.lastMatchId).toBe(5);
  });

  it('publica con model claude-mcp y tokens en cero, emite el evento y devuelve el resumen', async () => {
    const { servicio, repo, realtime } = armar();
    const { draftId } = await servicio.iniciar();

    const resumen = await servicio.publicar(draftId, notasValidas);

    expect(repo.insertEdition).toHaveBeenCalledWith(
      expect.objectContaining({
        publishedOn: '2026-11-17',
        model: 'claude-mcp',
        inputTokens: 0,
        outputTokens: 0,
      }),
    );
    expect(realtime.emit).toHaveBeenCalledWith(RealtimeEvent.NEWSLETTER_PUBLISHED, {
      publishedOn: '2026-11-17',
    });
    expect(resumen).toEqual({ editionNumber: 8, publishedOn: '2026-11-17', notas: 1 });
  });

  it('un borrador desconocido manda a llamar a diario_iniciar', async () => {
    const { servicio } = armar();

    await expect(servicio.publicar('no-existe', notasValidas)).rejects.toThrow(/diario_iniciar/);
  });

  it.each([
    ['sin portada', [{ ...notasValidas[0], seccion: 'TORNEO' }]],
    ['con dos portadas', [notasValidas[0], notasValidas[0]]],
  ])('EDICIÓN INVÁLIDA (%s): error con el motivo, no escribe y el borrador sigue vivo', async (_caso, notas) => {
    const { servicio, repo } = armar();
    const { draftId } = await servicio.iniciar();

    await expect(servicio.publicar(draftId, notas)).rejects.toThrow(/portada/i);
    expect(repo.insertEdition).not.toHaveBeenCalled();

    // El borrador sigue vivo: ahora con notas válidas publica.
    await expect(servicio.publicar(draftId, notasValidas)).resolves.toMatchObject({ editionNumber: 8 });
  });

  it('NO PUBLICA EN SILENCIO: un playerId inexistente se rechaza con la lista y el borrador sigue vivo', async () => {
    const { servicio, repo } = armar();
    const { draftId } = await servicio.iniciar();
    const conFantasma = [
      {
        ...notasValidas[0],
        jugadores: [
          { playerId: 1, rol: 'HEROE' },
          { playerId: 9999, rol: 'MENCION' },
        ],
      },
    ];

    await expect(servicio.publicar(draftId, conFantasma)).rejects.toThrow(/9999/);
    expect(repo.insertEdition).not.toHaveBeenCalled();

    // Corregida, publica.
    await expect(servicio.publicar(draftId, notasValidas)).resolves.toMatchObject({ editionNumber: 8 });
  });

  it('después de publicar, el mismo draftId ya no existe', async () => {
    const { servicio } = armar();
    const { draftId } = await servicio.iniciar();
    await servicio.publicar(draftId, notasValidas);

    await expect(servicio.publicar(draftId, notasValidas)).rejects.toThrow(/diario_iniciar/);
  });

  it('DOS CONVERSACIONES: si otra publicó la fecha, descarta el borrador y no escribe', async () => {
    const { servicio, repo } = armar();
    const { draftId } = await servicio.iniciar();

    // Otra conversación publicó mientras tanto.
    repo.findLastEdition.mockResolvedValue(edicion({ publishedOn: '2026-11-17' }));

    await expect(servicio.publicar(draftId, notasValidas)).rejects.toBeInstanceOf(NewsletterMcpError);
    expect(repo.insertEdition).not.toHaveBeenCalled();
    await expect(servicio.publicar(draftId, notasValidas)).rejects.toThrow(/diario_iniciar/);
  });

  /**
   * La forma REAL del error. El repositorio inserta dentro de `withTransaction`, que
   * pasa todo por `handleDatabaseError`, y éste convierte el 1062 de MySQL en una
   * `ConflictException` con el código DUPLICATE_ENTRY: ya no es un error de mysql2
   * con `errno`. El test de abajo (con el error crudo) pasaba mientras la rama no
   * detectaba nada en la práctica.
   */
  it('DOS CONVERSACIONES: la ConflictException real en que se convierte el 1062 descarta el borrador', async () => {
    const { servicio, repo } = armar();
    const { draftId } = await servicio.iniciar();
    repo.insertEdition.mockRejectedValue(
      new ConflictException({ message: 'Duplicate entry', errorCode: NativeErrorCode.DUPLICATE_ENTRY }),
    );

    await expect(servicio.publicar(draftId, notasValidas)).rejects.toThrow(/otra conversación/i);
    await expect(servicio.publicar(draftId, notasValidas)).rejects.toThrow(/diario_iniciar/);
  });

  it('DOS CONVERSACIONES: un UNIQUE (errno 1062) al insertar descarta el borrador', async () => {
    const { servicio, repo } = armar();
    const { draftId } = await servicio.iniciar();
    repo.insertEdition.mockRejectedValue(
      Object.assign(new Error("Duplicate entry '2026-11-17' secreto-interno"), { errno: 1062 }),
    );

    await expect(servicio.publicar(draftId, notasValidas)).rejects.toThrow(/otra conversación/i);
    await expect(servicio.publicar(draftId, notasValidas)).rejects.toThrow(/diario_iniciar/);
  });

  it('otro error de base deja el borrador vivo y no filtra el mensaje original', async () => {
    const { servicio, repo } = armar();
    const { draftId } = await servicio.iniciar();
    repo.insertEdition.mockRejectedValueOnce(new Error('detalle interno secreto de mysql'));

    const falla = servicio.publicar(draftId, notasValidas);
    await expect(falla).rejects.toBeInstanceOf(NewsletterMcpError);
    await expect(falla).rejects.not.toThrow(/secreto/);

    // El borrador sobrevive: el reintento publica.
    await expect(servicio.publicar(draftId, notasValidas)).resolves.toMatchObject({ editionNumber: 8 });
  });
});
