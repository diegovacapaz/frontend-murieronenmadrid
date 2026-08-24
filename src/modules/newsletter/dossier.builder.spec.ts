import { describe, expect, it, vi } from 'vitest';
import { DossierBuilder } from './dossier.builder';
import { SNAPSHOT_VERSION } from './newsletter.constants';

/**
 * Se testea con un DatabaseService falso que devuelve filas fijas: lo que se
 * prueba no es el SQL —eso lo prueba la corrida contra la base real— sino que
 * el builder arma bien la estructura y no pierde jugadores.
 */
function dbFalsa(overrides: Record<string, unknown[][]> = {}) {
  return {
    withConnection: vi.fn(),
    callMulti: vi.fn((sp: string) => Promise.resolve(overrides[sp] ?? [[]])),
    callList: vi.fn(() => Promise.resolve([])),
  };
}

/**
 * Las dos consultas que el builder resuelve por su cuenta, sin pasar por un
 * procedure. Son privadas, así que el test las alcanza por esta ventana en vez
 * de por un `as never` suelto: el cast queda en un solo lugar y con nombre.
 */
interface Consultas {
  historial: () => Promise<unknown>;
  jugadores: () => Promise<unknown>;
}

function armar(overrides: Record<string, unknown[][]> = {}) {
  const builder = new DossierBuilder(dbFalsa(overrides) as never);
  return { builder, consultas: builder as unknown as Consultas };
}

describe('DossierBuilder', () => {
  it('estampa la versión del snapshot', async () => {
    const { builder, consultas } = armar();
    vi.spyOn(consultas, 'historial').mockResolvedValue([]);
    vi.spyOn(consultas, 'jugadores').mockResolvedValue([]);

    const dossier = await builder.build([]);
    expect(dossier.estado.version).toBe(SNAPSHOT_VERSION);
  });

  it('incluye una entrada por jugador, incluso sin datos', async () => {
    const { builder, consultas } = armar();
    vi.spyOn(consultas, 'historial').mockResolvedValue([]);
    vi.spyOn(consultas, 'jugadores').mockResolvedValue([
      { playerId: 7, displayName: 'Nacho' },
      { playerId: 12, displayName: 'Fede' },
    ]);

    const dossier = await builder.build([]);
    expect(Object.keys(dossier.estado.jugadores)).toEqual(['7', '12']);
    expect(dossier.estado.jugadores[7].displayName).toBe('Nacho');
  });

  it('el ultimoMatchId es el del último partido del historial', async () => {
    const { builder, consultas } = armar();
    vi.spyOn(consultas, 'historial').mockResolvedValue([
      { matchId: 311 },
      { matchId: 314 },
    ]);
    vi.spyOn(consultas, 'jugadores').mockResolvedValue([]);

    const dossier = await builder.build([]);
    expect(dossier.contexto.ultimoMatchId).toBe(314);
  });

  /**
   * El que más importa. Es el que impide que alguien, mañana, meta el historial
   * dentro de `estado` y duplique trescientos partidos en cada fila de la tabla
   * de ediciones. Si algún día falla, la respuesta no es cambiar el test.
   */
  it('el historial NO viaja dentro del estado que se guarda', async () => {
    const { builder, consultas } = armar();
    vi.spyOn(consultas, 'historial').mockResolvedValue([{ matchId: 1 }]);
    vi.spyOn(consultas, 'jugadores').mockResolvedValue([]);

    const dossier = await builder.build([]);
    expect(JSON.stringify(dossier.estado)).not.toContain('matchId');
  });
});
