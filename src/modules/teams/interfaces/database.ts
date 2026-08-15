import type { Row } from '../../../database/database.types';
import type { Team } from '../enums/team.enum';

export interface TeamFields {
  team: Team;
  isDerbyTeam: boolean;
}

export interface TeamDB extends Row, TeamFields {}
