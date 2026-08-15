import { PartialType } from '@nestjs/swagger';
import { CreatePlayerDto } from './create-player.dto';

/**
 * Update parcial: el service trae la entidad, le aplica encima solo los campos
 * presentes y manda la fila completa al SP. Un PATCH sin `nickname` no borra el
 * apodo — para eso hay que mandarlo vacio explicitamente.
 */
export class UpdatePlayerDto extends PartialType(CreatePlayerDto) {}
