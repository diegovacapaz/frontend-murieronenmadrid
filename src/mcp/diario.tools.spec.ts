import { describe, expect, it, vi } from 'vitest';
import { NewsletterMcpError } from '../modules/newsletter/newsletter.errors';
import { aResultadoDeHerramienta, INSTRUCCIONES_DEL_SERVIDOR } from './diario.tools';
import { ErrorParaElRedactor } from './errores';

describe('aResultadoDeHerramienta con errores de otros productos', () => {
  it('cualquier subclase de ErrorParaElRedactor vuelve con su mensaje y no como error interno', async () => {
    class ErrorDeOtroProducto extends ErrorParaElRedactor {}

    const resultado = await aResultadoDeHerramienta(async () => {
      throw new ErrorDeOtroProducto('Mensaje para el redactor del otro producto.');
    });

    expect(resultado).toEqual({
      isError: true,
      content: [{ type: 'text', text: 'Mensaje para el redactor del otro producto.' }],
    });
  });
});

describe('INSTRUCCIONES_DEL_SERVIDOR', () => {
  /**
   * Es lo primero que ve el cliente, antes de llamar a nada, y el manual le llega
   * después como resultado de una herramienta (con menos peso que un system
   * prompt). Por eso repite lo que no se negocia.
   */
  it.each([
    'diario_iniciar',
    'cuenta con código',
    'no se negocia',
    'cuerpo, la familia, la salud, la plata ni el trabajo',
    'una sola nota de PORTADA',
    'una línea en blanco',
    'ortografía completa',
  ])('trae la regla: %s', (regla) => {
    expect(INSTRUCCIONES_DEL_SERVIDOR).toContain(regla);
  });

  it('también manda al ranking Powerade: powerade_iniciar', () => {
    expect(INSTRUCCIONES_DEL_SERVIDOR).toContain('powerade_iniciar');
  });

  it('es corto: se lee entero antes de empezar', () => {
    expect(INSTRUCCIONES_DEL_SERVIDOR.length).toBeLessThan(1500);
  });
});

describe('aResultadoDeHerramienta', () => {
  it('un string pasa tal cual, como un único bloque de texto', async () => {
    const resultado = await aResultadoDeHerramienta(async () => 'hola');

    expect(resultado).toEqual({ content: [{ type: 'text', text: 'hola' }] });
    expect(resultado.isError).toBeUndefined();
  });

  it('un objeto se serializa y el texto parsea al mismo objeto', async () => {
    const objeto = { draftId: 'abc', partidosNuevos: 2, jugadores: [{ playerId: 1 }] };

    const resultado = await aResultadoDeHerramienta(async () => objeto);

    expect(JSON.parse(resultado.content[0]!.text)).toEqual(objeto);
  });

  it('un NewsletterMcpError vuelve como error de herramienta con su mensaje', async () => {
    const resultado = await aResultadoDeHerramienta(async () => {
      throw new NewsletterMcpError('Llamá a diario_iniciar de nuevo.');
    });

    expect(resultado).toEqual({
      isError: true,
      content: [{ type: 'text', text: 'Llamá a diario_iniciar de nuevo.' }],
    });
  });

  it('un error inesperado vuelve con un texto fijo, sin el detalle, y se loguea el real', async () => {
    const log = vi.fn();

    const resultado = await aResultadoDeHerramienta(async () => {
      throw new Error('detalle interno secreto');
    }, log);

    expect(resultado.isError).toBe(true);
    expect(resultado.content[0]!.text).toContain('Error interno del diario');
    expect(resultado.content[0]!.text).not.toContain('secreto');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('detalle interno secreto'));
  });

  it('un valor que no se puede serializar no rompe: es un error interno', async () => {
    const circular: Record<string, unknown> = {};
    circular.yo = circular;

    const resultado = await aResultadoDeHerramienta(async () => circular);

    expect(resultado.isError).toBe(true);
    expect(resultado.content[0]!.text).toContain('Error interno del diario');
  });

  it('un valor undefined da un texto vacío y no un undefined suelto', async () => {
    const resultado = await aResultadoDeHerramienta(async () => undefined);

    expect(resultado.content[0]!.text).toBe('');
  });
});
