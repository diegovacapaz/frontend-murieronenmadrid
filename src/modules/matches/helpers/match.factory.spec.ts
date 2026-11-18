import { describe, expect, it } from 'vitest';
import { MatchState } from '../enums/match-state.enum';
import type { MatchDB } from '../interfaces/database';
import { MatchFactory } from './match.factory';

const base = {
  matchId: 70,
  tournamentId: 5,
  tournamentName: 'Apertura 2026',
  winnerTeam: null,
  goalsDiference: 0,
  place: 'LACONQUIJA',
  playedAt: new Date('2026-11-19T21:00:00'),
  isDerby: false,
};

describe('MatchFactory.toObject', () => {
  it('lee estado, convocados sin equipo y randoms que llegan como JSON string', () => {
    const row = {
      ...base,
      state: 'P',
      players: [{ playerId: 1, team: null, firstName: 'Juan', secondName: '-', nickname: null, displayName: 'Juan', photo: null }],
      guests: '[{"guestId": 9, "name": "Hernán", "team": null}]',
    } as unknown as MatchDB;

    const match = MatchFactory.toObject(row);

    expect(match.state).toBe(MatchState.PREPARING);
    expect(match.players[0].team).toBeNull();
    expect(match.guests).toEqual([{ guestId: 9, name: 'Hernán', team: null }]);
  });

  it('ordena los randoms por equipo y nombre', () => {
    const row = {
      ...base,
      state: 'R',
      players: [],
      guests: [
        { guestId: 2, name: 'Zoe', team: 'D' },
        { guestId: 3, name: 'Ana', team: 'L' },
        { guestId: 1, name: 'Beto', team: 'D' },
      ],
    } as unknown as MatchDB;

    expect(MatchFactory.toObject(row).guests.map((g) => g.name)).toEqual(['Beto', 'Zoe', 'Ana']);
  });

  it('sin columna guests (filas viejas) deja la lista vacia', () => {
    const row = { ...base, state: 'J', players: [] } as unknown as MatchDB;
    expect(MatchFactory.toObject(row).guests).toEqual([]);
  });
});
