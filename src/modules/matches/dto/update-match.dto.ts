import { OmitType } from '@nestjs/swagger';
import { CreateMatchDto } from './create-match.dto';

/**
 * La edicion reemplaza el partido entero, convocatoria incluida — no es un
 * PATCH parcial. Es lo que hace el SP (borra la formacion y escribe la nueva) y
 * lo que necesita la pantalla de carga, que edita el partido completo.
 *
 * `tournamentId` queda afuera: mover un partido de torneo cambiaria la
 * puntuacion con la que se calcularon sus puntos. Si hiciera falta, se borra y
 * se vuelve a cargar en el torneo correcto.
 */
export class UpdateMatchDto extends OmitType(CreateMatchDto, ['tournamentId'] as const) {}
