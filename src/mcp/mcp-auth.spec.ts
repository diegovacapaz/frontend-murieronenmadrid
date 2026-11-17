import { describe, expect, it } from 'vitest';
import {
  claveValida,
  decidirAcceso,
  extraerClave,
  LimitadorDeFallos,
  redactarUrl,
} from './mcp-auth';

describe('redactarUrl', () => {
  it('tapa la clave de la ruta /mcp/<clave>', () => {
    expect(redactarUrl('/mcp/SECRETA')).toBe('/mcp/[clave]');
  });

  it('conserva el query string y lo que venga después de la clave', () => {
    expect(redactarUrl('/mcp/SECRETA?x=1')).toBe('/mcp/[clave]?x=1');
    expect(redactarUrl('/mcp/SECRETA/otra')).toBe('/mcp/[clave]/otra');
  });

  it('no distingue mayúsculas en el prefijo', () => {
    expect(redactarUrl('/MCP/SECRETA')).toBe('/MCP/[clave]');
  });

  it('deja igual lo que no lleva clave', () => {
    expect(redactarUrl('/mcp')).toBe('/mcp');
    expect(redactarUrl('/mcp/')).toBe('/mcp/');
    expect(redactarUrl('/.well-known/oauth-protected-resource')).toBe(
      '/.well-known/oauth-protected-resource',
    );
    expect(redactarUrl('/mcpfoo/SECRETA')).toBe('/mcpfoo/SECRETA');
  });

  it('el resultado nunca contiene la clave', () => {
    expect(redactarUrl('/mcp/abc123XYZ-_?q=1')).not.toContain('abc123XYZ');
  });
});

describe('decidirAcceso', () => {
  it('una clave válida pasa aunque la IP esté bloqueada (detrás de un túnel todos comparten IP)', () => {
    expect(decidirAcceso(true, true)).toBe('permitir');
  });

  it('una clave válida pasa si la IP no está bloqueada', () => {
    expect(decidirAcceso(true, false)).toBe('permitir');
  });

  it('una clave inválida con la IP bloqueada se frena con 429', () => {
    expect(decidirAcceso(false, true)).toBe('frenar');
  });

  it('una clave inválida con la IP libre se rechaza con 401', () => {
    expect(decidirAcceso(false, false)).toBe('rechazar');
  });
});

describe('extraerClave', () => {
  it('lee la clave de Authorization: Bearer', () => {
    expect(extraerClave({ authorization: 'Bearer abc' }, '/')).toBe('abc');
  });

  it('el esquema Bearer no distingue mayúsculas', () => {
    expect(extraerClave({ authorization: 'bearer abc' }, '/')).toBe('abc');
  });

  it('lee la clave de X-API-Key (header en minúsculas, como lo entrega Node)', () => {
    expect(extraerClave({ 'x-api-key': 'xyz' }, '/')).toBe('xyz');
  });

  it('lee la clave de la ruta', () => {
    expect(extraerClave({}, '/KEY')).toBe('KEY');
  });

  it('ignora la barra final y el query string de la ruta', () => {
    expect(extraerClave({}, '/KEY/')).toBe('KEY');
    expect(extraerClave({}, '/KEY?x=1')).toBe('KEY');
  });

  it('una ruta vacía no trae clave', () => {
    expect(extraerClave({}, '/')).toBeNull();
    expect(extraerClave({}, '')).toBeNull();
  });

  it('si hay header y ruta a la vez, gana el header', () => {
    expect(extraerClave({ authorization: 'Bearer deHeader' }, '/deRuta')).toBe('deHeader');
  });

  it('un esquema que no es Bearer no cuenta como clave', () => {
    expect(extraerClave({ authorization: 'Basic abc' }, '/deRuta')).toBe('deRuta');
    expect(extraerClave({ authorization: 'Basic abc' }, '/')).toBeNull();
  });
});

describe('claveValida', () => {
  const esperada = 'k'.repeat(40);

  it('acepta la clave correcta', () => {
    expect(claveValida('k'.repeat(40), esperada)).toBe(true);
  });

  it('rechaza una clave distinta del mismo largo', () => {
    expect(claveValida('j'.repeat(40), esperada)).toBe(false);
  });

  it('rechaza una clave de distinto largo sin lanzar', () => {
    expect(claveValida('k'.repeat(10), esperada)).toBe(false);
    expect(claveValida('k'.repeat(400), esperada)).toBe(false);
  });

  it('rechaza null', () => {
    expect(claveValida(null, esperada)).toBe(false);
  });

  it('una clave esperada vacía no acepta nada, ni siquiera la cadena vacía', () => {
    expect(claveValida('', '')).toBe(false);
  });
});

describe('LimitadorDeFallos', () => {
  const t = 1_000_000;

  it('bloquea a la IP después de 10 fallos seguidos', () => {
    const limitador = new LimitadorDeFallos();
    for (let i = 0; i < 10; i += 1) limitador.registrarFallo('1.1.1.1', t);
    expect(limitador.bloqueado('1.1.1.1', t)).toBe(true);
  });

  it('con 9 fallos todavía no bloquea', () => {
    const limitador = new LimitadorDeFallos();
    for (let i = 0; i < 9; i += 1) limitador.registrarFallo('1.1.1.1', t);
    expect(limitador.bloqueado('1.1.1.1', t)).toBe(false);
  });

  it('no afecta a otra IP', () => {
    const limitador = new LimitadorDeFallos();
    for (let i = 0; i < 10; i += 1) limitador.registrarFallo('1.1.1.1', t);
    expect(limitador.bloqueado('2.2.2.2', t)).toBe(false);
  });

  it('pasada la ventana vuelve a dejar pasar', () => {
    const limitador = new LimitadorDeFallos();
    for (let i = 0; i < 10; i += 1) limitador.registrarFallo('1.1.1.1', t);
    expect(limitador.bloqueado('1.1.1.1', t + 60_001)).toBe(false);
  });
});
