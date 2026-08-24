import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

/** Lo que devuelve la lectura. */
export class PlayerLoreResponseDto {
  @ApiProperty({
    description: 'Notas personales del jugador. Cadena vacía si no tiene.',
    example: 'Jura ser 9 y siempre termina al arco. Rival histórico de Nacho.',
  })
  notes!: string;
}

/** Lo que acepta la escritura. */
export class UpdatePlayerLoreDto {
  @ApiProperty({
    description:
      'Notas personales. Vaciarlas borra el lore del jugador. El tope de 4000 ' +
      'es para que treinta jugadores no desborden el contexto del prompt.',
    maxLength: 4000,
  })
  @IsString()
  @MaxLength(4000)
  notes!: string;
}
