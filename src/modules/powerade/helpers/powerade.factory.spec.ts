import { describe, expect, it } from 'vitest';
import type { EntryRowDB, VersionRowDB } from '../interfaces/database';
import { PoweradeFactory } from './powerade.factory';

const version = (parcial: Partial<VersionRowDB> = {}): VersionRowDB =>
  ({
    rankingId: 1,
    tournamentId: 9,
    version: 1,
    lastMatchId: 70,
    revision: 1,
    publishedAt: new Date('2026-11-17T16:06:00.000Z'),
    ...parcial,
  }) as VersionRowDB;

const entrada = (parcial: Partial<EntryRowDB>): EntryRowDB =>
  ({
    rankingId: 1,
    position: 1,
    playerId: 10,
    displayName: 'David',
    photo: null,
    cups: 0,
    reason: 'Una razón.',
    ...parcial,
  }) as EntryRowDB;

describe('PoweradeFactory.toVersions', () => {
  it('pasa publishedAt a ISO con sufijo Z', () => {
    const [v] = PoweradeFactory.toVersions([version()], []);

    expect(v?.publishedAt).toBe('2026-11-17T16:06:00.000Z');
  });

  it('agrupa las entradas por versión y las ordena por puesto', () => {
    const versiones = PoweradeFactory.toVersions(
      [version({ rankingId: 2, version: 2 }), version({ rankingId: 1, version: 1 })],
      [
        entrada({ rankingId: 1, position: 2, playerId: 20 }),
        entrada({ rankingId: 2, position: 3, playerId: 30 }),
        entrada({ rankingId: 1, position: 1, playerId: 10 }),
        entrada({ rankingId: 2, position: 1, playerId: 10 }),
      ],
    );

    // Conserva el orden de las versiones que le pasan (de la más nueva a la más vieja).
    expect(versiones.map((v) => v.rankingId)).toEqual([2, 1]);
    expect(versiones[0]?.entries.map((e) => e.position)).toEqual([1, 3]);
    expect(versiones[1]?.entries.map((e) => [e.position, e.playerId])).toEqual([
      [1, 10],
      [2, 20],
    ]);
  });

  it('una versión sin entradas queda con entries vacío', () => {
    const [v] = PoweradeFactory.toVersions([version()], []);

    expect(v?.entries).toEqual([]);
  });

  it('copia los campos de la versión y de cada entrada', () => {
    const [v] = PoweradeFactory.toVersions(
      [version({ lastMatchId: 72, revision: 3 })],
      [entrada({ photo: 'foto.png', cups: 2, displayName: 'Colo', reason: 'Porque sí.' })],
    );

    expect(v).toMatchObject({ tournamentId: 9, version: 1, lastMatchId: 72, revision: 3 });
    expect(v?.entries[0]).toEqual({
      position: 1,
      playerId: 10,
      displayName: 'Colo',
      photo: 'foto.png',
      cups: 2,
      reason: 'Porque sí.',
    });
  });
});
