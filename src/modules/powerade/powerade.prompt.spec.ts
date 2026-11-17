import { describe, expect, it } from 'vitest';
import { construirSystemPowerade } from './powerade.prompt';

const config = {
  paperName: 'MurieronNews',
  groupLore: 'Lore del grupo de ejemplo.',
  styleGuide: 'Subí la mala leche.',
};

describe('construirSystemPowerade', () => {
  const manual = construirSystemPowerade(config, 'Torneo de Primavera');

  it.each([
    'powerade_iniciar',
    'powerade_material',
    'powerade_publicar',
    'REGLA DURA',
    'no es la tabla de puntos',
    'versionAnterior',
    'versionAReemplazar',
    'volvé a llamar a powerade_publicar',
  ])('contiene la cadena que enseña el flujo y el criterio: %s', (requerida) => {
    expect(manual).toContain(requerida);
  });

  it.each(['diario_iniciar', 'diario_publicar', 'publicarEdicion', 'historial.json'])(
    'no menciona lo propio del diario ni de la API: %s',
    (prohibido) => {
      expect(manual).not.toContain(prohibido);
    },
  );

  it('nombra el torneo', () => {
    expect(manual).toContain('Torneo de Primavera');
  });

  it('incluye el bloque del tono y el de las notas de cada jugador, los mismos del diario', () => {
    expect(manual).toContain('EL TONO');
    expect(manual).toContain('LAS NOTAS DE CADA JUGADOR');
  });

  it('incluye el lore del grupo y las indicaciones del editor', () => {
    expect(manual).toContain('Lore del grupo de ejemplo.');
    expect(manual).toContain('Subí la mala leche.');
  });

  it('las indicaciones del editor van al final: es la perilla que puede contradecir lo de arriba', () => {
    expect(manual.trimEnd().endsWith('Subí la mala leche.')).toBe(true);
  });

  it('sin lore ni indicaciones, no deja secciones vacías', () => {
    const sinNada = construirSystemPowerade(
      { paperName: 'MurieronNews', groupLore: null, styleGuide: null },
      'T',
    );

    // El encabezado de la sección lleva un salto de línea; el bloque compartido LAS_NOTAS
    // ya dice "bajo SOBRE EL GRUPO" en su texto, así que la frase suelta siempre está.
    expect(sinNada).not.toContain('SOBRE EL GRUPO\n');
    expect(sinNada).not.toContain('INDICACIONES DEL EDITOR');
  });

  it('pone un tope a la frase: hasta 200 caracteres, una sola oración', () => {
    expect(manual).toContain('200 caracteres');
    expect(manual).toMatch(/una sola oración/i);
  });
});
