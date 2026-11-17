import { describe, expect, it } from 'vitest';
import { validate } from './env.validation';

/** Las variables obligatorias, con valores que pasan la validación. */
const base = {
  CORS_ORIGIN: 'http://localhost:5173',
  MYSQL_HOST: 'localhost',
  MYSQL_PORT: '3306',
  MYSQL_USER: 'mem',
  MYSQL_PASSWORD: '123456789',
  MYSQL_DATABASE: 'murieron_en_madrid',
  ADMIN_PASSWORD: 'cambiame-por-favor',
  ADMIN_TOKEN_SECRET: 'cambiame-por-una-cadena-larga',
  ANTHROPIC_API_KEY: 'sk-ant-cambiame',
};

describe('validate: ANTHROPIC_API_KEY', () => {
  const { ANTHROPIC_API_KEY: _omitida, ...sinLaKey } = base;

  it('es opcional: sin ella el backend arranca (el diario se escribe por el MCP)', () => {
    expect(validate(sinLaKey).ANTHROPIC_API_KEY).toBeUndefined();
  });

  it('si viene, tiene que tener al menos 10 caracteres', () => {
    expect(() => validate({ ...sinLaKey, ANTHROPIC_API_KEY: 'corta' })).toThrow(/ANTHROPIC_API_KEY/);
    expect(validate({ ...sinLaKey, ANTHROPIC_API_KEY: 'sk-ant-1234567890' }).ANTHROPIC_API_KEY).toBe(
      'sk-ant-1234567890',
    );
  });
});

/**
 * docker-compose pasa una variable sin valor (`MCP_API_KEY: ${MCP_API_KEY:-}`) como
 * CADENA VACÍA, no como ausente: `MCP_API_KEY=` en un .env es lo mismo. Para las
 * dos claves opcionales, vacía significa "no configurada" y no puede hacer que el
 * proceso muera en el arranque por no llegar al largo mínimo.
 */
describe('validate: las claves opcionales vacías cuentan como ausentes', () => {
  it('MCP_API_KEY vacía: arranca y el MCP queda apagado', () => {
    expect(validate({ ...base, MCP_API_KEY: '' }).MCP_API_KEY).toBeUndefined();
  });

  it('ANTHROPIC_API_KEY vacía: arranca y la API de Anthropic queda apagada', () => {
    expect(validate({ ...base, ANTHROPIC_API_KEY: '' }).ANTHROPIC_API_KEY).toBeUndefined();
  });

  it('una clave corta SIGUE rechazándose: sólo la cadena vacía se normaliza', () => {
    expect(() => validate({ ...base, MCP_API_KEY: 'corta' })).toThrow(/MCP_API_KEY/);
  });

  it('una obligatoria vacía no se normaliza (no cambia el comportamiento de las demás)', () => {
    expect(validate({ ...base, MYSQL_PASSWORD: '' }).MYSQL_PASSWORD).toBe('');
  });
});

describe('validate: MCP_API_KEY', () => {
  it('es opcional: sin ella el backend arranca y el MCP queda apagado', () => {
    expect(validate(base).MCP_API_KEY).toBeUndefined();
  });

  it('rechaza una clave de 31 caracteres y el mensaje nombra la variable', () => {
    expect(() => validate({ ...base, MCP_API_KEY: 'k'.repeat(31) })).toThrow(/MCP_API_KEY/);
  });

  it('acepta una clave de 32 caracteres', () => {
    expect(validate({ ...base, MCP_API_KEY: 'k'.repeat(32) }).MCP_API_KEY).toBe('k'.repeat(32));
  });
});
