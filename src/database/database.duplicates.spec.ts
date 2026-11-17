import { BadRequestException, ConflictException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { NativeErrorCode } from './database.errors';
import { esEntradaDuplicada } from './database.duplicates';

describe('esEntradaDuplicada', () => {
  it('reconoce el error crudo de MySQL (errno 1062)', () => {
    expect(esEntradaDuplicada(Object.assign(new Error('Duplicate entry'), { errno: 1062 }))).toBe(
      true,
    );
  });

  it('reconoce la ConflictException en la que handleDatabaseError convierte el 1062', () => {
    const traducido = new ConflictException({
      message: 'Duplicate entry',
      errorCode: NativeErrorCode.DUPLICATE_ENTRY,
    });

    expect(esEntradaDuplicada(traducido)).toBe(true);
  });

  it('una ConflictException por otro motivo no es un duplicado', () => {
    expect(
      esEntradaDuplicada(new ConflictException({ message: 'x', errorCode: 'OTRA_COSA' })),
    ).toBe(false);
  });

  it.each([
    ['otro errno de MySQL', Object.assign(new Error('x'), { errno: 1451 })],
    ['otra excepción de Nest', new BadRequestException('x')],
    ['un Error común', new Error('x')],
    ['un string', 'Duplicate entry'],
    ['null', null],
  ])('%s: false', (_caso, error) => {
    expect(esEntradaDuplicada(error)).toBe(false);
  });
});
