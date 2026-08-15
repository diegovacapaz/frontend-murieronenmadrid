import { PickType } from '@nestjs/swagger';
import { CreatePenaltyDto } from './create-penalty.dto';

/**
 * Solo cambia el valor: el par (torneo, jugador) es la clave primaria y viaja
 * en la URL. Cambiarlo seria borrar una penalizacion y crear otra.
 */
export class UpdatePenaltyDto extends PickType(CreatePenaltyDto, ['penalty'] as const) {}
