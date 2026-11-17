import { describe, expect, it, vi } from 'vitest';
import type { EntradaRanking, VersionRanking } from './entities/powerade.entity';
import { PoweradeService } from './powerade.service';

const entrada = (position: number, playerId: number): EntradaRanking => ({
  position,
  playerId,
  displayName: `Jugador ${playerId}`,
  photo: null,
  cups: 0,
  reason: `Razón ${playerId}`,
});

const version = (parcial: Partial<VersionRanking> = {}): VersionRanking => ({
  rankingId: 1,
  tournamentId: 6,
  version: 1,
  lastMatchId: 70,
  revision: 1,
  publishedAt: '2026-11-17T16:06:00.000Z',
  entries: [entrada(1, 10), entrada(2, 20), entrada(3, 30)],
  ...parcial,
});

function armar(
  opciones: {
    torneo?: { tournamentId: number; name: string; state: 'P' | 'F'; wasTracked: boolean } | null;
    versiones?: VersionRanking[];
    conteo?: { contados: number; nuevos: number };
  } = {},
) {
  const repo = {
    findTournament: vi
      .fn()
      .mockResolvedValue(
        opciones.torneo === undefined
          ? { tournamentId: 6, name: 'T', state: 'P', wasTracked: true }
          : opciones.torneo,
      ),
    findLatestVersions: vi.fn().mockResolvedValue(opciones.versiones ?? [version()]),
    countMatches: vi.fn().mockResolvedValue(opciones.conteo ?? { contados: 7, nuevos: 2 }),
  };
  return { servicio: new PoweradeService(repo as never), repo };
}

describe('PoweradeService.findByTournament', () => {
  it('un torneo que no existe: null', async () => {
    const { servicio } = armar({ torneo: null });

    await expect(servicio.findByTournament(99)).resolves.toBeNull();
  });

  it('un torneo TERMINADO: null (la tarjeta desaparece sola)', async () => {
    const { servicio, repo } = armar({
      torneo: { tournamentId: 6, name: 'T', state: 'F', wasTracked: true },
    });

    await expect(servicio.findByTournament(6)).resolves.toBeNull();
    expect(repo.findLatestVersions).not.toHaveBeenCalled();
  });

  it('un torneo sin detalle de partidos: null', async () => {
    const { servicio } = armar({
      torneo: { tournamentId: 6, name: 'T', state: 'P', wasTracked: false },
    });

    await expect(servicio.findByTournament(6)).resolves.toBeNull();
  });

  it('todavía no hay ninguna versión: null', async () => {
    const { servicio } = armar({ versiones: [] });

    await expect(servicio.findByTournament(6)).resolves.toBeNull();
  });

  it('una versión vigente con sólo dos puestos (se borró un jugador): null', async () => {
    const { servicio } = armar({ versiones: [version({ entries: [entrada(1, 10), entrada(3, 30)] })] });

    await expect(servicio.findByTournament(6)).resolves.toBeNull();
  });

  it('el caso feliz: la versión, los tres puestos y los partidos contados y nuevos', async () => {
    const { servicio, repo } = armar();

    const respuesta = await servicio.findByTournament(6);

    expect(respuesta).toMatchObject({
      version: 1,
      lastMatchId: 70,
      publishedAt: '2026-11-17T16:06:00.000Z',
      partidosContados: 7,
      partidosNuevos: 2,
    });
    expect(respuesta?.entries.map((e) => e.playerId)).toEqual([10, 20, 30]);
    expect(respuesta?.entries[0]).toMatchObject({ position: 1, displayName: 'Jugador 10', reason: 'Razón 10' });
    // Pide las dos últimas versiones y cuenta contra el puntero de la vigente.
    expect(repo.findLatestVersions).toHaveBeenCalledWith(6, 2);
    expect(repo.countMatches).toHaveBeenCalledWith(6, 70);
  });

  it('sin versión anterior, ningún puesto trae movimiento', async () => {
    const { servicio } = armar({ versiones: [version()] });

    const respuesta = await servicio.findByTournament(6);

    expect(respuesta?.entries.map((e) => e.movement)).toEqual([null, null, null]);
  });

  it('con versión anterior, los movimientos se calculan contra ELLA', async () => {
    const vigente = version({
      rankingId: 2,
      version: 2,
      entries: [entrada(1, 30), entrada(2, 10), entrada(3, 99)],
    });
    const anterior = version({ rankingId: 1, version: 1 }); // 10, 20, 30
    const { servicio } = armar({ versiones: [vigente, anterior] });

    const respuesta = await servicio.findByTournament(6);

    expect(respuesta?.entries.map((e) => e.movement)).toEqual([
      { tipo: 'sube', lugares: 2 },
      { tipo: 'baja', lugares: 1 },
      { tipo: 'entra', lugares: 0 },
    ]);
  });
});
