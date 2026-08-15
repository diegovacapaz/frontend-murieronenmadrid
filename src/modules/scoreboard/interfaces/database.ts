import type { EntityState } from '../../../common/enums/entity-state.enum';
import type { Row } from '../../../database/database.types';
import type { PlayerChampionship } from '../../players/entities/player.entity';

export interface StandingFields {
  position: number;
  playerId: number;
  displayName: string;
  nickname: string | null;
  photo: string | null;
  playerState: EntityState;
  isSagrado: boolean;
  cups: number;
  played: number;
  won: number;
  drew: number;
  lost: number;
  goalsDiference: number;
  points: number;
  maxPoints: number;
  winRate: number | null;
  penalty: number;
  netPoints: number;
}

export interface GeneralStandingFields extends StandingFields {
  tournamentsPlayed: number;
  championships: PlayerChampionship[];
}

export interface StandingDB extends Row, StandingFields {}
export interface GeneralStandingDB extends Row, GeneralStandingFields {}
