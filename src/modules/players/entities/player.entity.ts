import { EntityState } from '../../../common/enums/entity-state.enum';

/** Un torneo ganado por el jugador. Se calcula en la base, no se persiste. */
export class PlayerChampionship {
  tournamentId!: number;
  name!: string;
}

/**
 * Modelo de dominio de un jugador.
 *
 * `displayName`, `cups` y `championships` no son columnas: los resuelve
 * vPlayerDetail en cada lectura. Estan en la entidad igual porque forman parte
 * de lo que un jugador ES para este sistema —las estrellas del perfil salen de
 * ahi— y porque calcularlos en la base es justamente lo que pide el
 * requerimiento.
 */
export class Player {
  playerId!: number;
  firstName!: string;
  secondName!: string;
  nickname!: string | null;
  displayName!: string;
  photo!: string | null;
  state!: EntityState;
  isSagrado!: boolean;
  createdAt!: Date;
  cups!: number;
  championships!: PlayerChampionship[];

  isActive(): boolean {
    return this.state === EntityState.ACTIVE;
  }
}
