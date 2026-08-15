import type { Row } from '../../../database/database.types';
import type { EntityState } from '../../../common/enums/entity-state.enum';
import type { PlayerChampionship } from '../entities/player.entity';

/**
 * Campos de Player tal como vienen de la BD, SIN la index signature de Row.
 * Sirve para composicion via Omit/Pick sin perder los tipos concretos (la index
 * signature de RowDataPacket hace que Omit<PlayerDB, ...> colapse a
 * `{ [key: string]: any }`).
 */
export interface PlayerFields {
  playerId: number;
  firstName: string;
  secondName: string;
  nickname: string | null;
  displayName: string;
  photo: string | null;
  state: EntityState;
  isSagrado: boolean;
  createdAt: Date;
  cups: number;
  /** Llega ya parseado: el typeCast del pool convierte las columnas JSON. */
  championships: PlayerChampionship[];
}

/**
 * Shape exacto de una fila devuelta por los SPs de jugadores.
 * Convenciones: camelCase igual que las columnas; los Date ya vienen casteados
 * por el typeCast del pool.
 */
export interface PlayerDB extends Row, PlayerFields {}
