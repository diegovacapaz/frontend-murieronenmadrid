import { describe, expect, it } from 'vitest';
import { construirSystemMcp } from './newsletter.prompt.mcp';

const config = {
  paperName: 'MurieronNews',
  groupLore: 'Lore del grupo de ejemplo.',
  styleGuide: 'Subí la mala leche.',
};

describe.each([
  ['diaria', false],
  ['inaugural', true],
])('construirSystemMcp (%s)', (_nombre, esInaugural) => {
  const manual = construirSystemMcp(config, esInaugural);

  it.each(['historial.json', '/files/input', 'json.load', 'publicarEdicion'])(
    'no menciona lo propio del sandbox de la API: %s',
    (prohibido) => {
      expect(manual).not.toContain(prohibido);
    },
  );

  it.each([
    'diario_iniciar',
    'diario_material',
    'diario_publicar',
    'partidosNuevos',
    'avisale al editor',
    'volvé a llamar a diario_publicar',
    'REGLA DURA',
  ])('contiene la cadena que enseña el flujo: %s', (requerida) => {
    expect(manual).toContain(requerida);
  });

  it.each([
    'BREVES',
    'separados por una línea en blanco',
    'Nunca un solo párrafo',
    'una o dos frases',
  ])('enseña el formato de los BREVES (el diario los dibuja un ítem por línea): %s', (requerida) => {
    expect(manual).toContain(requerida);
  });

  it('incluye el nombre del diario, el lore del grupo y las indicaciones del editor', () => {
    expect(manual).toContain('MurieronNews');
    expect(manual).toContain('Lore del grupo de ejemplo.');
    expect(manual).toContain('Subí la mala leche.');
  });

  it('las indicaciones del editor van al final', () => {
    expect(manual.trimEnd().endsWith('Subí la mala leche.')).toBe(true);
  });
});

describe('construirSystemMcp: inaugural vs diaria', () => {
  it('sólo la inaugural trae el bloque del número uno', () => {
    expect(construirSystemMcp(config, true)).toContain('NÚMERO UNO');
    expect(construirSystemMcp(config, false)).not.toContain('NÚMERO UNO');
  });
});
