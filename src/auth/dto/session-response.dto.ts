import { ApiProperty } from '@nestjs/swagger';

export class SessionResponseDto {
  @ApiProperty({
    description: 'Token a mandar en `Authorization: Bearer <token>` para escribir.',
  })
  token!: string;

  @ApiProperty({ description: 'Vida del token, en formato ms (12h, 7d).', example: '12h' })
  expiresIn!: string;

  @ApiProperty({ description: 'Siempre true: solo se emite token si la clave era correcta.' })
  isAdmin!: boolean;
}
