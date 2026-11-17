import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { NativeErrorCode } from '../../database/database.errors';
import { RealtimeEvent } from '../../realtime/realtime.events';
import type { Dossier } from '../newsletter/interfaces/dossier';
import type { VersionRanking } from './entities/powerade.entity';
import { PoweradeConflictoError, PoweradeMcpError } from './powerade.errors';
import { PoweradeMcpService } from './powerade-mcp.service';

const config = { paperName: 'MurieronNews', groupLore: 'lore', styleGuide: 'Subí la mala leche.', isEnabled: false };

const PARTICIPANTES = [
  { playerId: 10, displayName: 'Ana', partidos: 5 },
  { playerId: 20, displayName: 'Beto', partidos: 4 },
  { playerId: 30, displayName: 'Cami', partidos: 4 },
  { playerId: 40, displayName: 'Dani', partidos: 2 },
];

function dossierDe(marca = 'A'): Dossier {
  return {
    estado: {
      version: 1,
      general: { marca },
      torneoActivo: { estadisticas: true },
      mundialito: {},
      catalogoLogros: [{ code: 'CAZADOR' }],
      jugadores: {
        10: { displayName: 'Ana' },
        20: { displayName: 'Beto' },
        30: { displayName: 'Cami' },
        40: { displayName: 'Dani' },
        77: { displayName: 'Nunca jugó este torneo' },
      },
    },
    historial: [1, 2, 3, 4, 5].map((matchId) => ({ matchId, tournamentId: 6 })),
    contexto: {
      fecha: '2026-11-17',
      ultimoMatchId: 5,
      titularesRecientes: [],
      loreGrupo: 'lore',
      lorePorJugador: { 10: 'es del Real' },
    },
  } as unknown as Dossier;
}

const version = (parcial: Partial<VersionRanking> = {}): VersionRanking => ({
  rankingId: 1,
  tournamentId: 6,
  version: 1,
  lastMatchId: 3,
  revision: 1,
  publishedAt: '2026-11-17T16:06:00.000Z',
  entries: [
    { position: 1, playerId: 10, displayName: 'Ana', photo: null, cups: 0, reason: 'Primera.' },
    { position: 2, playerId: 20, displayName: 'Beto', photo: null, cups: 0, reason: 'Segundo.' },
    { position: 3, playerId: 30, displayName: 'Cami', photo: null, cups: 0, reason: 'Tercera.' },
  ],
  ...parcial,
});

const top3Valido = [
  { playerId: 10, razon: 'Primera con un dato.' },
  { playerId: 20, razon: 'Segundo con un dato.' },
  { playerId: 30, razon: 'Tercera con un dato.' },
];

function armar(
  opciones: {
    torneo?: { tournamentId: number; name: string; state: 'P' | 'F'; wasTracked: boolean } | null;
    jugandoId?: number | null;
    participantes?: typeof PARTICIPANTES;
    versiones?: VersionRanking[];
    max?: number | null;
    conteo?: { contados: number; nuevos: number };
  } = {},
) {
  const repo = {
    findTournament: vi.fn().mockResolvedValue(
      opciones.torneo === undefined
        ? { tournamentId: 6, name: 'Torneo de Primavera', state: 'P', wasTracked: true }
        : opciones.torneo,
    ),
    findPlayingTournamentId: vi.fn().mockResolvedValue(opciones.jugandoId === undefined ? 6 : opciones.jugandoId),
    findLatestVersions: vi.fn().mockResolvedValue(opciones.versiones ?? []),
    findParticipants: vi.fn().mockResolvedValue(opciones.participantes ?? PARTICIPANTES),
    findMaxMatchId: vi.fn().mockResolvedValue(opciones.max === undefined ? 5 : opciones.max),
    countMatches: vi.fn().mockResolvedValue(opciones.conteo ?? { contados: 3, nuevos: 2 }),
    findTournamentTable: vi.fn().mockResolvedValue([{ position: 1, playerId: 10 }]),
    insertRanking: vi.fn().mockResolvedValue(version({ rankingId: 2, version: 2 })),
    replaceRanking: vi.fn().mockResolvedValue(version({ revision: 2 })),
  };
  const newsletterService = { findConfig: vi.fn().mockResolvedValue(config) };
  const builder = { build: vi.fn().mockResolvedValue(dossierDe()) };
  const realtime = { emit: vi.fn() };
  const servicio = new PoweradeMcpService(
    repo as never,
    newsletterService as never,
    builder as never,
    realtime as never,
  );
  return { servicio, repo, newsletterService, builder, realtime };
}

describe('PoweradeMcpService.iniciar', () => {
  it('sin torneo en juego rebota con un mensaje que lo dice', async () => {
    const { servicio } = armar({ jugandoId: null });

    await expect(servicio.iniciar()).rejects.toBeInstanceOf(PoweradeMcpError);
    await expect(servicio.iniciar()).rejects.toThrow(/en juego/i);
  });

  it('sin tournamentId usa el torneo en juego; con tournamentId usa ése', async () => {
    const sin = armar();
    await sin.servicio.iniciar();
    expect(sin.repo.findPlayingTournamentId).toHaveBeenCalled();
    expect(sin.repo.findTournament).toHaveBeenCalledWith(6);

    const con = armar({ torneo: { tournamentId: 9, name: 'Otro', state: 'P', wasTracked: true } });
    await con.servicio.iniciar(9);
    expect(con.repo.findPlayingTournamentId).not.toHaveBeenCalled();
    expect(con.repo.findTournament).toHaveBeenCalledWith(9);
  });

  it('un torneo inexistente, terminado o sin detalle rebota', async () => {
    await expect(armar({ torneo: null }).servicio.iniciar(99)).rejects.toBeInstanceOf(PoweradeMcpError);
    await expect(
      armar({ torneo: { tournamentId: 6, name: 'T', state: 'F', wasTracked: true } }).servicio.iniciar(),
    ).rejects.toThrow(/en juego/i);
    await expect(
      armar({ torneo: { tournamentId: 6, name: 'T', state: 'P', wasTracked: false } }).servicio.iniciar(),
    ).rejects.toThrow(/detalle/i);
  });

  it('con menos de tres jugadores que hayan jugado el torneo rebota', async () => {
    const { servicio } = armar({ participantes: PARTICIPANTES.slice(0, 2) });

    await expect(servicio.iniciar()).rejects.toThrow(/tres/i);
  });

  it('EL PUNTERO ES EL QUE VIO EL REDACTOR: findMaxMatchId se lee ANTES de armar el dossier', async () => {
    const { servicio, repo, builder } = armar();

    await servicio.iniciar();

    expect(repo.findMaxMatchId.mock.invocationCallOrder[0]).toBeLessThan(
      builder.build.mock.invocationCallOrder[0]!,
    );
    expect(builder.build).toHaveBeenCalledWith(expect.anything(), { tournamentId: 6 });
  });

  it('sin versiones previas: sin versionAnterior ni versionAReemplazar, y todos los partidos son nuevos', async () => {
    const { servicio, repo } = armar({ versiones: [] });

    const briefing = await servicio.iniciar();

    expect(briefing.versionAnterior).toBeNull();
    expect(briefing.versionAReemplazar).toBeNull();
    expect(briefing.aviso).toBeNull();
    expect(repo.countMatches).toHaveBeenCalledWith(6, 0);
    expect(briefing.partidosNuevos).toBe(2);
  });

  it('con una versión y partidos nuevos: ella es la base de las flechas y no hay nada que reemplazar', async () => {
    const { servicio } = armar({ versiones: [version({ lastMatchId: 3 })], max: 5 });

    const briefing = await servicio.iniciar();

    expect(briefing.versionAnterior).toEqual({
      version: 1,
      lastMatchId: 3,
      puestos: [
        { position: 1, playerId: 10, displayName: 'Ana', razon: 'Primera.' },
        { position: 2, playerId: 20, displayName: 'Beto', razon: 'Segundo.' },
        { position: 3, playerId: 30, displayName: 'Cami', razon: 'Tercera.' },
      ],
    });
    expect(briefing.versionAReemplazar).toBeNull();
    expect(briefing.aviso).toBeNull();
  });

  it('SIN partidos nuevos NO rebota: avisa, publicar reemplaza la vigente y la base de las flechas es la anterior a ella', async () => {
    const vigente = version({ rankingId: 2, version: 2, lastMatchId: 5 });
    const anterior = version({ rankingId: 1, version: 1, lastMatchId: 3 });
    const { servicio } = armar({
      versiones: [vigente, anterior],
      max: 5,
      conteo: { contados: 5, nuevos: 0 },
    });

    const briefing = await servicio.iniciar();

    expect(briefing.partidosNuevos).toBe(0);
    expect(briefing.aviso).toMatch(/no hay partidos nuevos/i);
    expect(briefing.aviso).toMatch(/reemplaz/i);
    expect(briefing.versionAReemplazar?.version).toBe(2);
    expect(briefing.versionAnterior?.version).toBe(1);
  });

  it('reemplazando la primera versión, no hay versión anterior', async () => {
    const { servicio } = armar({
      versiones: [version({ lastMatchId: 5 })],
      max: 5,
      conteo: { contados: 5, nuevos: 0 },
    });

    const briefing = await servicio.iniciar();

    expect(briefing.versionAReemplazar?.version).toBe(1);
    expect(briefing.versionAnterior).toBeNull();
  });

  it('el manual lleva el styleGuide de la configuración y NO respeta isEnabled', async () => {
    // La config del fake tiene isEnabled: false (el diario "apagado"): el Powerade no lo mira.
    const { servicio } = armar();

    const briefing = await servicio.iniciar();

    expect(briefing.manual).toContain('Subí la mala leche.');
    expect(briefing.manual).toContain('Torneo de Primavera');
    expect(briefing.manual).toContain('powerade_publicar');
  });

  it('devuelve los participantes, el lore y el tamaño de cada pieza del material', async () => {
    const { servicio } = armar();

    const briefing = await servicio.iniciar();

    expect(briefing.participantes).toEqual(PARTICIPANTES);
    expect(briefing.torneo).toEqual({ tournamentId: 6, nombre: 'Torneo de Primavera', partidosJugados: 3 });
    expect(briefing.contexto.loreGrupo).toBe('lore');
    expect(briefing.contexto.lorePorJugador).toEqual({ 10: 'es del Real' });
    expect(briefing.material.torneoChars).toBeGreaterThan(0);
    expect(briefing.material.jugadoresChars).toBeGreaterThan(0);
    expect(briefing.material.historialChars).toBeGreaterThan(0);
  });
});

describe('PoweradeMcpService.material', () => {
  it('un draftId desconocido manda a llamar a powerade_iniciar', () => {
    const { servicio } = armar();

    expect(() => servicio.material('no-existe', 'torneo')).toThrow(/powerade_iniciar/);
  });

  it('devuelve las tres partes como JSON parseable', async () => {
    const { servicio } = armar();
    const { draftId } = await servicio.iniciar();

    expect(JSON.parse(servicio.material(draftId, 'torneo'))).toMatchObject({
      tabla: [{ position: 1, playerId: 10 }],
      estadisticas: { estadisticas: true },
    });
    expect(Array.isArray(JSON.parse(servicio.material(draftId, 'historial')))).toBe(true);
  });

  it('jugadores sólo trae a quienes jugaron el torneo, más el catálogo de logros', async () => {
    const { servicio } = armar();
    const { draftId } = await servicio.iniciar();

    const jugadores = JSON.parse(servicio.material(draftId, 'jugadores')) as {
      jugadores: Record<string, unknown>;
      catalogoLogros: unknown[];
    };

    expect(Object.keys(jugadores.jugadores).sort()).toEqual(['10', '20', '30', '40']);
    expect(jugadores.catalogoLogros).toEqual([{ code: 'CAZADOR' }]);
  });

  it('historial con desdeMatchId trae sólo los posteriores', async () => {
    const { servicio } = armar();
    const { draftId } = await servicio.iniciar();

    const ids = (JSON.parse(servicio.material(draftId, 'historial', 3)) as Array<{ matchId: number }>).map(
      (p) => p.matchId,
    );

    expect(ids).toEqual([4, 5]);
  });
});

describe('PoweradeMcpService.publicar', () => {
  it('un borrador desconocido manda a llamar a powerade_iniciar', async () => {
    const { servicio } = armar();

    await expect(servicio.publicar('no-existe', top3Valido)).rejects.toThrow(/powerade_iniciar/);
  });

  it('BASE CONGELADA: se guarda el lastMatchId del borrador, no el de ahora', async () => {
    const { servicio, repo } = armar({ max: 5 });
    const { draftId } = await servicio.iniciar();
    repo.findMaxMatchId.mockResolvedValue(80); // entró un partido después

    await servicio.publicar(draftId, top3Valido);

    expect(repo.insertRanking).toHaveBeenCalledWith(
      {
        tournamentId: 6,
        lastMatchId: 5,
        model: 'claude-mcp',
        entradas: [
          { playerId: 10, reason: 'Primera con un dato.' },
          { playerId: 20, reason: 'Segundo con un dato.' },
          { playerId: 30, reason: 'Tercera con un dato.' },
        ],
      },
      null, // sin versiones previas: la base es "ninguna"
    );
  });

  it.each([
    ['dos jugadores', [top3Valido[0], top3Valido[1]]],
    ['un jugador repetido', [top3Valido[0], top3Valido[0], top3Valido[2]]],
    ['una frase de 301 caracteres', [top3Valido[0], top3Valido[1], { playerId: 30, razon: 'x'.repeat(301) }]],
    ['un jugador que no jugó el torneo', [top3Valido[0], top3Valido[1], { playerId: 77, razon: 'No jugó.' }]],
  ])('TOP 3 INVÁLIDO (%s): rechaza con los problemas, no escribe y el borrador sigue vivo', async (_caso, top3) => {
    const { servicio, repo } = armar();
    const { draftId } = await servicio.iniciar();

    await expect(servicio.publicar(draftId, top3)).rejects.toBeInstanceOf(PoweradeMcpError);
    expect(repo.insertRanking).not.toHaveBeenCalled();
    expect(repo.replaceRanking).not.toHaveBeenCalled();

    await expect(servicio.publicar(draftId, top3Valido)).resolves.toMatchObject({ accion: 'nueva' });
  });

  it('el mensaje de un top 3 inválido lista TODOS los problemas', async () => {
    const { servicio } = armar();
    const { draftId } = await servicio.iniciar();

    const error = await servicio
      .publicar(draftId, [{ playerId: 10, razon: '' }, { playerId: 10, razon: 'x' }, { playerId: 77, razon: 'y' }])
      .catch((e: Error) => e);

    expect((error as Error).message).toMatch(/frase/i);
    expect((error as Error).message).toMatch(/repetido/i);
    expect((error as Error).message).toContain('77');
  });

  it('UN TORNEO QUE TERMINÓ EN EL MEDIO: rebota, descarta el borrador y no escribe', async () => {
    const { servicio, repo } = armar();
    const { draftId } = await servicio.iniciar();
    repo.findTournament.mockResolvedValue({ tournamentId: 6, name: 'T', state: 'F', wasTracked: true });

    await expect(servicio.publicar(draftId, top3Valido)).rejects.toThrow(/terminó/i);
    expect(repo.insertRanking).not.toHaveBeenCalled();
    await expect(servicio.publicar(draftId, top3Valido)).rejects.toThrow(/powerade_iniciar/);
  });

  it('UNA CONVERSACIÓN VIEJA NO PISA UNA VERSIÓN NUEVA: otra vigente → conflicto, nada escrito, borrador descartado', async () => {
    const { servicio, repo } = armar({ versiones: [version({ rankingId: 1, revision: 1 })] });
    const { draftId } = await servicio.iniciar();
    // Mientras tanto otra conversación publicó una versión más nueva.
    repo.findLatestVersions.mockResolvedValue([version({ rankingId: 2, version: 2, revision: 1 })]);

    await expect(servicio.publicar(draftId, top3Valido)).rejects.toThrow(/otra conversación/i);
    expect(repo.insertRanking).not.toHaveBeenCalled();
    expect(repo.replaceRanking).not.toHaveBeenCalled();
    await expect(servicio.publicar(draftId, top3Valido)).rejects.toThrow(/powerade_iniciar/);
  });

  it('la misma versión con otra revisión (otro reemplazó): conflicto', async () => {
    const { servicio, repo } = armar({ versiones: [version({ lastMatchId: 5, revision: 1 })], max: 5 });
    const { draftId } = await servicio.iniciar();
    repo.findLatestVersions.mockResolvedValue([version({ lastMatchId: 5, revision: 2 })]);

    await expect(servicio.publicar(draftId, top3Valido)).rejects.toThrow(/otra conversación/i);
  });

  it('con partidos nuevos inserta una versión nueva y devuelve "nueva"', async () => {
    const { servicio, repo, realtime } = armar({ versiones: [version({ lastMatchId: 3 })], max: 5 });
    const { draftId } = await servicio.iniciar();

    const resultado = await servicio.publicar(draftId, top3Valido);

    expect(repo.insertRanking).toHaveBeenCalledTimes(1);
    expect(repo.replaceRanking).not.toHaveBeenCalled();
    expect(resultado).toEqual({ tournamentId: 6, version: 2, accion: 'nueva' });
    expect(realtime.emit).toHaveBeenCalledWith(RealtimeEvent.POWERADE_PUBLISHED, { tournamentId: 6 });
  });

  it('sin partidos nuevos REEMPLAZA la vigente con su base (rankingId y revisión) y devuelve "reemplazada"', async () => {
    const vigente = version({ rankingId: 7, version: 4, lastMatchId: 5, revision: 3 });
    const { servicio, repo } = armar({ versiones: [vigente], max: 5, conteo: { contados: 5, nuevos: 0 } });
    const { draftId } = await servicio.iniciar();

    const resultado = await servicio.publicar(draftId, top3Valido);

    expect(repo.replaceRanking).toHaveBeenCalledWith(
      { rankingId: 7, revision: 3 },
      expect.objectContaining({ tournamentId: 6, lastMatchId: 5 }),
    );
    expect(repo.insertRanking).not.toHaveBeenCalled();
    expect(resultado.accion).toBe('reemplazada');
  });

  it('un PoweradeConflictoError del repositorio (se perdió la carrera) descarta el borrador', async () => {
    const vigente = version({ lastMatchId: 5 });
    const { servicio, repo } = armar({ versiones: [vigente], max: 5, conteo: { contados: 5, nuevos: 0 } });
    const { draftId } = await servicio.iniciar();
    repo.replaceRanking.mockRejectedValue(new PoweradeConflictoError());

    await expect(servicio.publicar(draftId, top3Valido)).rejects.toThrow(/otra conversación/i);
    await expect(servicio.publicar(draftId, top3Valido)).rejects.toThrow(/powerade_iniciar/);
  });

  it('un UNIQUE al insertar (la excepción real que llega del repositorio) descarta el borrador', async () => {
    const { servicio, repo } = armar();
    const { draftId } = await servicio.iniciar();
    repo.insertRanking.mockRejectedValue(
      new ConflictException({ message: 'Duplicate entry', errorCode: NativeErrorCode.DUPLICATE_ENTRY }),
    );

    await expect(servicio.publicar(draftId, top3Valido)).rejects.toThrow(/otra conversación/i);
    await expect(servicio.publicar(draftId, top3Valido)).rejects.toThrow(/powerade_iniciar/);
  });

  it('otro error de base: el modelo recibe un mensaje genérico (sin el original) y el borrador sigue vivo', async () => {
    const { servicio, repo } = armar();
    const { draftId } = await servicio.iniciar();
    repo.insertRanking.mockRejectedValueOnce(new Error('detalle interno secreto de mysql'));

    const falla = servicio.publicar(draftId, top3Valido);
    await expect(falla).rejects.toBeInstanceOf(PoweradeMcpError);
    await expect(falla).rejects.not.toThrow(/secreto/);

    await expect(servicio.publicar(draftId, top3Valido)).resolves.toMatchObject({ accion: 'nueva' });
  });

  it('insertar le pasa al repositorio la BASE del borrador (rankingId y revisión) para que la compruebe adentro de la transacción', async () => {
    const { servicio, repo } = armar({ versiones: [version({ rankingId: 7, lastMatchId: 3, revision: 4 })], max: 5 });
    const { draftId } = await servicio.iniciar();

    await servicio.publicar(draftId, top3Valido);

    expect(repo.insertRanking).toHaveBeenCalledWith(expect.anything(), { rankingId: 7, revision: 4 });
  });

  it('un PoweradeConflictoError al INSERTAR (otra conversación publicó entre la lectura y la transacción) descarta el borrador', async () => {
    const { servicio, repo } = armar();
    const { draftId } = await servicio.iniciar();
    repo.insertRanking.mockRejectedValue(new PoweradeConflictoError());

    await expect(servicio.publicar(draftId, top3Valido)).rejects.toThrow(/otra conversación/i);
    await expect(servicio.publicar(draftId, top3Valido)).rejects.toThrow(/powerade_iniciar/);
  });

  it('DOBLE ENVÍO: dos publicar SIMULTÁNEOS con el mismo draftId publican UNA sola vez', async () => {
    const { servicio, repo } = armar();
    const { draftId } = await servicio.iniciar();
    // El insert tarda: el segundo llega mientras el primero todavía está en vuelo.
    repo.insertRanking.mockImplementation(
      () => new Promise((resolver) => setTimeout(() => resolver(version({ rankingId: 2, version: 2 })), 25)),
    );

    const [a, b] = await Promise.allSettled([
      servicio.publicar(draftId, top3Valido),
      servicio.publicar(draftId, top3Valido),
    ]);

    expect(repo.insertRanking).toHaveBeenCalledTimes(1);
    expect([a.status, b.status].sort()).toEqual(['fulfilled', 'rejected']);
    const rechazo = [a, b].find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect((rechazo.reason as Error).message).toMatch(/ya se está publicando/i);
  });

  it('si el primer envío falla por un error de base, el borrador NO queda trabado en "publicando": se puede reintentar', async () => {
    const { servicio, repo } = armar();
    const { draftId } = await servicio.iniciar();
    repo.insertRanking.mockRejectedValueOnce(new Error('se cayó la base'));

    await expect(servicio.publicar(draftId, top3Valido)).rejects.toBeInstanceOf(PoweradeMcpError);
    await expect(servicio.publicar(draftId, top3Valido)).resolves.toMatchObject({ accion: 'nueva' });
  });

  it('después de publicar, el mismo draftId ya no existe', async () => {
    const { servicio } = armar();
    const { draftId } = await servicio.iniciar();
    await servicio.publicar(draftId, top3Valido);

    await expect(servicio.publicar(draftId, top3Valido)).rejects.toThrow(/powerade_iniciar/);
  });
});
