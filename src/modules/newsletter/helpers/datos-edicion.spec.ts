import { describe, expect, it } from 'vitest';
import type { Dossier } from '../interfaces/dossier';
import type { NotaValidada } from '../interfaces/validacion';
import { armarDatosEdicion } from './datos-edicion';

const dossier = {
  estado: { version: 7, general: {}, torneoActivo: null, mundialito: {}, catalogoLogros: [], jugadores: {} },
  historial: [],
  contexto: {
    fecha: '2026-11-17',
    ultimoMatchId: 321,
    titularesRecientes: [],
    loreGrupo: null,
    lorePorJugador: {},
  },
} as unknown as Dossier;

const notas = [
  { seccion: 'P', titular: 'T', copete: 'C', cuerpo: 'B', jugadores: [] },
] as unknown as NotaValidada[];

describe('armarDatosEdicion', () => {
  const datos = armarDatosEdicion('2026-11-17', dossier, notas, {
    model: 'claude-mcp',
    inputTokens: 11,
    outputTokens: 22,
  });

  it('usa la fecha que se le pasa, no la del dossier', () => {
    expect(armarDatosEdicion('2026-08-25', dossier, notas, { model: 'm', inputTokens: 0, outputTokens: 0 }).publishedOn).toBe('2026-08-25');
    expect(datos.publishedOn).toBe('2026-11-17');
  });

  it('el puntero es el último matchId que contó el dossier', () => {
    expect(datos.lastMatchId).toBe(321);
  });

  it('la versión y el snapshot salen del estado del dossier, sin copiarlo', () => {
    expect(datos.snapshotVersion).toBe(7);
    expect(datos.snapshot).toBe(dossier.estado);
  });

  it('las notas pasan tal cual', () => {
    expect(datos.notas).toBe(notas);
  });

  it('el modelo y los tokens salen de `uso`', () => {
    expect(datos.model).toBe('claude-mcp');
    expect(datos.inputTokens).toBe(11);
    expect(datos.outputTokens).toBe(22);
  });
});
