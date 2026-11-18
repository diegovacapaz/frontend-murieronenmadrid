import { describe, expect, it } from 'vitest';
import { AlmacenDeBorradores } from './borradores';

const HORA = 60 * 60 * 1000;

/** Un reloj que se mueve a mano. */
function relojFalso(inicio = 1_000_000) {
  let ahora = inicio;
  return { ahora: () => ahora, avanzar: (ms: number) => void (ahora += ms) };
}

describe('AlmacenDeBorradores', () => {
  it('guardar y obtener devuelve el mismo valor', () => {
    const almacen = new AlmacenDeBorradores<{ n: number }>();
    const valor = { n: 1 };

    expect(almacen.obtener(almacen.guardar(valor))).toBe(valor);
  });

  it('dos borradores tienen ids distintos', () => {
    const almacen = new AlmacenDeBorradores<number>();

    expect(almacen.guardar(1)).not.toBe(almacen.guardar(2));
  });

  it('un id inexistente da null', () => {
    expect(new AlmacenDeBorradores<number>().obtener('no-existe')).toBeNull();
  });

  it('vive hasta justo el vencimiento y vence un milisegundo después', () => {
    const reloj = relojFalso();
    const almacen = new AlmacenDeBorradores<number>({ ttlMs: 3 * HORA, ahora: reloj.ahora });
    const id = almacen.guardar(42);

    reloj.avanzar(3 * HORA);
    expect(almacen.obtener(id)).toBe(42);

    reloj.avanzar(1);
    expect(almacen.obtener(id)).toBeNull();
  });

  it('por defecto vence a las 3 horas', () => {
    const reloj = relojFalso();
    const almacen = new AlmacenDeBorradores<number>({ ahora: reloj.ahora });
    const id = almacen.guardar(1);

    reloj.avanzar(3 * HORA);
    expect(almacen.obtener(id)).toBe(1);
    reloj.avanzar(1);
    expect(almacen.obtener(id)).toBeNull();
  });

  it('descartar lo deja inaccesible, y descartar uno inexistente no lanza', () => {
    const almacen = new AlmacenDeBorradores<number>();
    const id = almacen.guardar(1);

    almacen.descartar(id);
    expect(almacen.obtener(id)).toBeNull();
    expect(() => almacen.descartar('no-existe')).not.toThrow();
  });

  it('al guardar un cuarto borrador se descarta el más viejo y quedan los otros tres', () => {
    const reloj = relojFalso();
    const almacen = new AlmacenDeBorradores<number>({ ahora: reloj.ahora });
    const ids = [1, 2, 3, 4].map((valor) => {
      reloj.avanzar(10);
      return almacen.guardar(valor);
    });

    expect(almacen.obtener(ids[0])).toBeNull();
    expect(ids.slice(1).map((id) => almacen.obtener(id))).toEqual([2, 3, 4]);
  });

  it('un borrador vencido no cuenta para el tope', () => {
    const reloj = relojFalso();
    const almacen = new AlmacenDeBorradores<number>({ ttlMs: 100, ahora: reloj.ahora });
    const viejos = [1, 2, 3].map((valor) => almacen.guardar(valor));

    reloj.avanzar(101); // los tres vencieron
    const nuevos = [4, 5, 6].map((valor) => almacen.guardar(valor));

    expect(viejos.map((id) => almacen.obtener(id))).toEqual([null, null, null]);
    expect(nuevos.map((id) => almacen.obtener(id))).toEqual([4, 5, 6]);
  });
});
