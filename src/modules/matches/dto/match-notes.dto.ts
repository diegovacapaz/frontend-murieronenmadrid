import { ApiProperty } from '@nestjs/swagger';

/**
 * Lo que devuelve la lectura de las notas de un partido.
 *
 * No hay DTO de escritura: las notas se cargan al dar de alta o editar el
 * partido, dentro de la misma transacción, y por eso viajan en
 * `CreateMatchDto`/`UpdateMatchDto`. Si el partido no se guarda, las notas
 * tampoco — que es exactamente lo que se quiere.
 */
export class MatchNotesResponseDto {
  @ApiProperty({
    description: 'Notas del administrador. Cadena vacía si el partido no tiene.',
    example: 'Llovía toda la tarde y la cancha era un barrial. Faltaron dos.',
  })
  notes!: string;
}
