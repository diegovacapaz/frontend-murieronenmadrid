import { PartialType } from '@nestjs/swagger';
import { CreateTournamentDto } from './create-tournament.dto';

/**
 * Solo se puede editar un torneo en juego (lo valida el SP). Cambiar la
 * puntuacion de un torneo cerrado reescribiria una tabla ya publicada y podria
 * mover al campeon.
 */
export class UpdateTournamentDto extends PartialType(CreateTournamentDto) {}
