import { describe, expect, it } from 'vitest';
import { cerrarEnSilencio } from './cierre';

describe('cerrarEnSilencio', () => {
  it('cierra todo lo que recibe', async () => {
    let cerrados = 0;
    const cerrable = { close: () => Promise.resolve().then(() => void (cerrados += 1)) };

    cerrarEnSilencio(cerrable, cerrable);
    await new Promise((resolve) => setImmediate(resolve));

    expect(cerrados).toBe(2);
  });

  it('un close que rechaza NO genera un rechazo sin manejar (que tiraría el proceso)', async () => {
    const sinManejar: unknown[] = [];
    const escuchar = (razon: unknown): void => void sinManejar.push(razon);
    process.on('unhandledRejection', escuchar);

    try {
      cerrarEnSilencio({ close: () => Promise.reject(new Error('se rompió al cerrar')) });
      await new Promise((resolve) => setTimeout(resolve, 20));
    } finally {
      process.off('unhandledRejection', escuchar);
    }

    expect(sinManejar).toEqual([]);
  });

  it('un close que lanza de forma síncrona no corta el cierre de los demás', async () => {
    let cerrado = false;

    expect(() =>
      cerrarEnSilencio(
        {
          close: () => {
            throw new Error('explotó');
          },
        },
        { close: () => Promise.resolve().then(() => void (cerrado = true)) },
      ),
    ).not.toThrow();
    await new Promise((resolve) => setImmediate(resolve));

    expect(cerrado).toBe(true);
  });
});
