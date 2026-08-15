import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({
    description: 'Clave de administracion. Habilita todas las operaciones de escritura.',
    example: 'la-clave-del-grupo',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  password!: string;
}
