import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { construirSystem, EL_TONO, LAS_NOTAS } from './newsletter.prompt';

/** Los bloques de tono se exportan para que el Powerade los reuse sin copiarlos. */
describe('bloques de tono exportados', () => {
  it('EL_TONO es el bloque del tono', () => {
    expect(EL_TONO).toContain('EL TONO');
  });

  it('LAS_NOTAS es el bloque de las notas de cada jugador', () => {
    expect(LAS_NOTAS).toContain('LAS NOTAS DE CADA JUGADOR');
  });
});

const config = {
  paperName: 'MurieronNews',
  groupLore: 'Lore del grupo de ejemplo.',
  styleGuide: 'Subí la mala leche.',
};

const sha256 = (texto: string): string => createHash('sha256').update(texto).digest('hex');

/**
 * Caracterización del manual de la API.
 *
 * Este manual es el prefijo que el caché de prompt reutiliza entre turnos: **un
 * solo byte distinto lo invalida** y la edición pasa a costar el doble sin que
 * nada falle. Por eso estos hashes se calcularon sobre el texto ANTES de
 * extraer las variantes para el MCP, y tienen que seguir siendo los mismos
 * después. Si un cambio a propósito del manual los rompe, se recalculan acá a
 * conciencia; si se rompen sin querer, el refactor cambió el texto.
 */
describe('construirSystem (manual de la API): no cambia ni un byte', () => {
  it('edición inaugural', () => {
    expect(sha256(construirSystem(config, true))).toBe(
      'b0be27f45b074a6c6264a56a90c8366fad318896255bad1d453c261b72812246',
    );
  });

  it('edición diaria', () => {
    expect(sha256(construirSystem(config, false))).toBe(
      '994d4c2e92f80b891163ac0bbd6dae47f7020aa19b07e241c6fa9f87d327d2fb',
    );
  });
});
