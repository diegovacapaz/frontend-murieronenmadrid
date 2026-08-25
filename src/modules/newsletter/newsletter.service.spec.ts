import { describe, expect, it } from 'vitest';
import type { LastEdition } from './entities/edition.entity';
import { hayMaterialSinContar, hayNovedades, yaHayEdicionDe } from './newsletter.service';

describe('hayNovedades', () => {
  it('sin ediciones previas, cualquier partido es novedad', () => {
    expect(hayNovedades(314, null)).toBe(true);
  });

  it('sin ediciones previas y sin partidos, no hay nada que contar', () => {
    expect(hayNovedades(null, null)).toBe(false);
  });

  it('con el puntero al día, no hay novedades', () => {
    expect(hayNovedades(314, 314)).toBe(false);
  });

  it('con un partido nuevo, hay novedades', () => {
    expect(hayNovedades(315, 314)).toBe(true);
  });

  it('si se borró el último partido, no hay novedades', () => {
    // El puntero quedó adelante del máximo. No es un caso de error: alguien
    // borró un partido ya contado. No hay nada nuevo que decir.
    expect(hayNovedades(313, 314)).toBe(false);
  });
});

describe('yaHayEdicionDe', () => {
  const conFecha = (publishedOn: string): LastEdition =>
    ({ publishedOn }) as LastEdition;

  it('sin ediciones previas, la fecha esta libre', () => {
    expect(yaHayEdicionDe('2026-08-25', null)).toBe(false);
  });

  it('con la edicion de hoy ya publicada, la fecha esta tomada', () => {
    // El caso que costo USD 2,50: la inaugural salio a la manana y el boton
    // volvio a apretarse el mismo dia. El UNIQUE de publishedOn rebotaba el
    // INSERT DESPUES de la llamada a la API.
    expect(yaHayEdicionDe('2026-08-25', conFecha('2026-08-25'))).toBe(true);
  });

  it('con la ultima edicion de ayer, la fecha esta libre', () => {
    expect(yaHayEdicionDe('2026-08-25', conFecha('2026-08-24'))).toBe(false);
  });
});

describe('hayMaterialSinContar', () => {
  const contoHasta = (lastMatchId: number): LastEdition =>
    ({ lastMatchId }) as LastEdition;

  it('con un partido cargado despues de la edicion, hay material nuevo', () => {
    // El caso de Diego: la inaugural salio a la manana con el puntero en 314 y
    // despues cargo el 315. Regenerar tiene que diffear contra la foto de esa
    // misma edicion, que es el mundo sin el 315.
    expect(hayMaterialSinContar(contoHasta(314), 315)).toBe(true);
  });

  it('sin partidos nuevos, no hay material que contar', () => {
    // Regenerar por redaccion: se reescribe la misma historia contra la
    // edicion ANTERIOR, no contra si misma.
    expect(hayMaterialSinContar(contoHasta(314), 314)).toBe(false);
  });

  it('la segunda regeneracion seguida ya no encuentra material', () => {
    // La primera adelanto el puntero hasta el 315, asi que esta vuelve sola al
    // camino de reescribir en vez de salir en blanco.
    expect(hayMaterialSinContar(contoHasta(315), 315)).toBe(false);
  });

  it('si se borro el partido nuevo, tampoco hay material', () => {
    expect(hayMaterialSinContar(contoHasta(315), 314)).toBe(false);
  });
});
