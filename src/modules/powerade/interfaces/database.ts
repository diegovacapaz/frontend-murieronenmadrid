import type { Row } from '../../../database/database.types';

/**
 * Filas crudas tal como vuelven del pool de este sistema, que tiene un
 * `typeCast` propio: los `DATETIME` llegan como `Date` en UTC y los `BOOLEAN`
 * como boolean de verdad. Traducirlas es trabajo del factory.
 */

export interface TournamentRowDB extends Row {
  tournamentId: number;
  name: string;
  state: string; // el CHAR(1) crudo: 'P' o 'F'
  wasTracked: boolean;
}

export interface VersionRowDB extends Row {
  rankingId: number;
  tournamentId: number;
  version: number;
  lastMatchId: number;
  revision: number;
  publishedAt: Date;
}

export interface EntryRowDB extends Row {
  rankingId: number;
  position: number;
  playerId: number;
  displayName: string;
  photo: string | null;
  cups: number;
  reason: string;
}

export interface ParticipantRowDB extends Row {
  playerId: number;
  displayName: string;
  partidos: number;
}
