import { describe, expect, it } from 'vitest';
import { NewsletterMcpError } from '../modules/newsletter/newsletter.errors';
import { ErrorParaElRedactor } from './errores';

describe('ErrorParaElRedactor', () => {
  it('es un Error con el mensaje que lee el redactor', () => {
    const error = new ErrorParaElRedactor('Llamá a algo de nuevo.');

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('Llamá a algo de nuevo.');
  });

  it('NewsletterMcpError hereda de él y conserva su mensaje y su nombre', () => {
    const error = new NewsletterMcpError('mensaje del diario');

    expect(error).toBeInstanceOf(ErrorParaElRedactor);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('mensaje del diario');
    expect(error.name).toBe('NewsletterMcpError');
  });
});
