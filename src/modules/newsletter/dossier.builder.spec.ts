import { describe, expect, it, vi } from 'vitest';
import { DossierBuilder } from './dossier.builder';
import { SNAPSHOT_VERSION } from './newsletter.constants';

/** Una conexión que devuelve cero filas para cualquier consulta. */
interface ConexionFalsa {
  execute: () => Promise<[unknown[], unknown[]]>;
}

/**
 * Se testea con un DatabaseService falso que devuelve filas fijas: lo que se
 * prueba no es el SQL —eso lo prueba la corrida contra la base real— sino que
 * el builder arma bien la estructura y no pierde jugadores.
 *
 * `withConnection` ejecuta de verdad la función que recibe, contra una conexión
 * que no devuelve filas. No es un detalle: con un `vi.fn()` pelado devolvería
 * `undefined` y los helpers que no están mockeados —`lore()`, `torneoActivo()`,
 * `maxMatchId()`— no se ejercitarían en ningún test, quedando cubiertos por
 * accidente. Con cero filas cada uno tiene que resolver su caso vacío solo.
 */
function dbFalsa(overrides: Record<string, unknown[][]> = {}) {
  const conexion: ConexionFalsa = { execute: () => Promise.resolve([[], []]) };

  return {
    withConnection: vi.fn(<T>(fn: (conn: ConexionFalsa) => Promise<T>) => fn(conexion)),
    callMulti: vi.fn((sp: string) => Promise.resolve(overrides[sp] ?? [[]])),
    callList: vi.fn(() => Promise.resolve([])),
  };
}

/**
 * Las tres consultas que el builder resuelve por su cuenta, sin pasar por un
 * procedure. Son privadas, así que el test las alcanza por esta ventana en vez
 * de por un `as never` suelto: el cast queda en un solo lugar y con nombre.
 */
interface Consultas {
  historial: () => Promise<unknown>;
  jugadores: () => Promise<unknown>;
  maxMatchId: () => Promise<number>;
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
    // Sin lore cargado las dos claves tienen que existir igual, con su vacío
    // explícito: el prompt distingue "no hay lore" de "la clave no vino".
    expect(dossier.contexto.loreGrupo).toBeNull();
    expect(dossier.contexto.lorePorJugador).toEqual({});
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

  /**
   * El puntero es `MAX(matchId)`, no el final del historial. El historial va
   * ordenado por `playedAt`, así que su último elemento es el partido más
   * reciente y no el de id más alto; un partido con fecha retroactiva —que
   * `CreateMatch` acepta sin validar— los separa. Si el dossier guardara el más
   * chico, el guard del cron (`MAX(matchId) != lastMatchId`) quedaría verdadero
   * para siempre y el diario publicaría todos los días lo que ya contó.
   *
   * Por eso el historial de este test termina en 314 y la marca de agua es 320:
   * la implementación que mira `historial.at(-1)` no puede pasarlo.
   */
  it('el ultimoMatchId sale de MAX(matchId), no del final del historial', async () => {
    const { builder, consultas } = armar();
    vi.spyOn(consultas, 'historial').mockResolvedValue([
      { matchId: 311 },
      { matchId: 314 },
    ]);
    vi.spyOn(consultas, 'jugadores').mockResolvedValue([]);
    vi.spyOn(consultas, 'maxMatchId').mockResolvedValue(320);

    const dossier = await builder.build([]);
    expect(dossier.contexto.ultimoMatchId).toBe(320);
  });

  /**
   * El que más importa. Es el que impide que alguien, mañana, meta el historial
   * dentro de `estado` y duplique trescientos partidos en cada fila de la tabla
   * de ediciones. Si algún día falla, la respuesta no es cambiar el test.
   *
   * El jugador mockeado no es decorativo. Con `jugadores` en `[]` el test solo
   * mira la rama de arriba de `estado` y deja pasar la variante MÁS cara: meter
   * el historial dentro de CADA entrada de `jugadores`, que lo duplicaría
   * veintisiete veces en vez de una. Con un jugador, esa rama también se
   * recorre.
   */
  it('el historial NO viaja dentro del estado que se guarda', async () => {
    const { builder, consultas } = armar();
    vi.spyOn(consultas, 'historial').mockResolvedValue([{ matchId: 1 }]);
    vi.spyOn(consultas, 'jugadores').mockResolvedValue([
      { playerId: 7, displayName: 'Nacho' },
    ]);

    const dossier = await builder.build([]);
    expect(JSON.stringify(dossier.estado)).not.toContain('matchId');
  });
});
