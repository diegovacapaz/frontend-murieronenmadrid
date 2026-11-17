import { describe, expect, it } from 'vitest';
import type { LastEdition } from '../entities/edition.entity';
import type { Dossier } from '../interfaces/dossier';
import { contarPartidosNuevos, extraerMaterial } from './material';

describe('contarPartidosNuevos', () => {
  const historial = [1, 2, 3, 4, 5].map((matchId) => ({ matchId }));

  it('sin puntero, todos los partidos son nuevos', () => {
    expect(contarPartidosNuevos(historial, null)).toBe(5);
  });

  it('con el puntero en el máximo, no hay nuevos', () => {
    expect(contarPartidosNuevos(historial, 5)).toBe(0);
  });

  it('cuenta sólo los posteriores al puntero', () => {
    expect(contarPartidosNuevos(historial, 2)).toBe(3);
  });

  it('con un puntero adelantado del máximo (se borró un partido), no hay nuevos', () => {
    expect(contarPartidosNuevos(historial, 9)).toBe(0);
  });
});

describe('extraerMaterial', () => {
  const dossier = {
    estado: { version: 3, general: { total: 5 }, torneoActivo: null, mundialito: {}, catalogoLogros: [], jugadores: {} },
    historial: [1, 2, 3, 4, 5].map((matchId) => ({ matchId, place: `cancha ${matchId}` })),
    contexto: { fecha: '2026-11-17', ultimoMatchId: 5, titularesRecientes: [], loreGrupo: null, lorePorJugador: {} },
  } as unknown as Dossier;

  const anterior = {
    snapshot: { version: 3, general: { total: 4 } },
  } as unknown as LastEdition;

  it('historial: devuelve todos los partidos como JSON', () => {
    const texto = extraerMaterial({ dossier, anterior }, 'historial');

    expect(JSON.parse(texto!)).toEqual(dossier.historial);
  });

  it('historial con desdeMatchId: sólo los posteriores', () => {
    const texto = extraerMaterial({ dossier, anterior }, 'historial', 3);

    expect((JSON.parse(texto!) as Array<{ matchId: number }>).map((p) => p.matchId)).toEqual([4, 5]);
  });

  it('historial es JSON compacto: sin saltos de línea de indentación', () => {
    expect(extraerMaterial({ dossier, anterior }, 'historial')).not.toContain('\n');
  });

  it('estado: devuelve el estado del dossier', () => {
    expect(JSON.parse(extraerMaterial({ dossier, anterior }, 'estado')!)).toEqual(dossier.estado);
  });

  it('estado_anterior: devuelve el snapshot de la edición anterior', () => {
    expect(JSON.parse(extraerMaterial({ dossier, anterior }, 'estado_anterior')!)).toEqual(anterior.snapshot);
  });

  it('estado_anterior es null cuando no hay edición anterior', () => {
    expect(extraerMaterial({ dossier, anterior: null }, 'estado_anterior')).toBeNull();
  });

  it('estado_anterior es null cuando la edición anterior no tiene snapshot', () => {
    const sinFoto = { snapshot: null } as unknown as LastEdition;

    expect(extraerMaterial({ dossier, anterior: sinFoto }, 'estado_anterior')).toBeNull();
  });
});
