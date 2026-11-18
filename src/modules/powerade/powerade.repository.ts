import { Injectable } from '@nestjs/common';
import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../../database/database.service';
import type { VersionRanking } from './entities/powerade.entity';
import { PoweradeFactory } from './helpers/powerade.factory';
import type {
  EntryRowDB,
  ParticipantRowDB,
  TournamentRowDB,
  VersionRowDB,
} from './interfaces/database';
import type {
  DatosRanking,
  IPoweradeRepository,
  TorneoParaRanking,
} from './interfaces/powerade.repository.interface';
import { PoweradeConflictoError } from './powerade.errors';

/** El único lugar de este módulo que toca la base. */
@Injectable()
export class PoweradeRepository implements IPoweradeRepository {
  constructor(private readonly db: DatabaseService) {}

  async findTournament(tournamentId: number): Promise<TorneoParaRanking | null> {
    return this.db.withConnection(async (conn) => {
      const [rows] = await conn.execute<TournamentRowDB[] & RowDataPacket[]>(
        `SELECT tournamentId, \`name\`, state, wasTracked
           FROM Tournaments
          WHERE tournamentId = ?`,
        [tournamentId],
      );

      const fila = rows[0];
      if (!fila) return null;

      return {
        tournamentId: fila.tournamentId,
        name: fila.name,
        state: fila.state === 'P' ? 'P' : 'F',
        wasTracked: fila.wasTracked,
      };
    });
  }

  async findPlayingTournamentId(): Promise<number | null> {
    return this.db.withConnection(async (conn) => {
      // El mismo criterio que el DossierBuilder para "el torneo en juego" (el de
      // `startedAt` más reciente, con el id como desempate para que no dependa del
      // plan del optimizador), más `wasTracked`: un torneo del que sólo se conserva
      // la tabla no tiene marcadores con los que juzgar.
      const [rows] = await conn.execute<{ tournamentId: number }[] & RowDataPacket[]>(
        `SELECT tournamentId
           FROM Tournaments
          WHERE state = 'P' AND wasTracked = TRUE
          ORDER BY startedAt DESC, tournamentId DESC
          LIMIT 1`,
      );

      return rows[0]?.tournamentId ?? null;
    });
  }

  async findLatestVersions(tournamentId: number, cantidad: number): Promise<VersionRanking[]> {
    // `LIMIT ?` con un prepared statement de mysql2 falla según cómo viaje el
    // número; como `cantidad` es un entero que decide el código y no el usuario,
    // se valida y se interpola.
    const limite = Math.trunc(cantidad);
    if (!Number.isInteger(limite) || limite < 1) {
      throw new RangeError('findLatestVersions: cantidad tiene que ser un entero positivo');
    }

    return this.db.withConnection(async (conn) => {
      const [versiones] = await conn.execute<VersionRowDB[] & RowDataPacket[]>(
        `SELECT rankingId, tournamentId, version, lastMatchId, revision, publishedAt
           FROM PoweradeRankings
          WHERE tournamentId = ?
          ORDER BY version DESC
          LIMIT ${limite}`,
        [tournamentId],
      );

      return this.conEntradas(conn, versiones);
    });
  }

  async findParticipants(
    tournamentId: number,
  ): Promise<Array<{ playerId: number; displayName: string; partidos: number }>> {
    return this.db.withConnection(async (conn) => {
      const [rows] = await conn.execute<ParticipantRowDB[] & RowDataPacket[]>(
        `SELECT mp.playerId,
                p.displayName,
                CAST(COUNT(*) AS SIGNED) AS partidos
           FROM vPlayedMatchPlayers mp
           INNER JOIN vPlayerDetail p ON p.playerId = mp.playerId
          WHERE mp.tournamentId = ?
          GROUP BY mp.playerId, p.displayName
          ORDER BY partidos DESC, p.displayName`,
        [tournamentId],
      );

      return rows.map((fila) => ({
        playerId: fila.playerId,
        displayName: fila.displayName,
        partidos: fila.partidos,
      }));
    });
  }

  async findMaxMatchId(tournamentId: number): Promise<number | null> {
    return this.db.withConnection(async (conn) => {
      const [rows] = await conn.execute<{ maxMatchId: number | null }[] & RowDataPacket[]>(
        `SELECT MAX(matchId) AS maxMatchId FROM vPlayedMatches WHERE tournamentId = ?`,
        [tournamentId],
      );

      return rows[0]?.maxMatchId ?? null;
    });
  }

  async countMatches(
    tournamentId: number,
    lastMatchId: number,
  ): Promise<{ contados: number; nuevos: number }> {
    return this.db.withConnection(async (conn) => {
      const [rows] = await conn.execute<
        { contados: number; nuevos: number }[] & RowDataPacket[]
      >(
        `SELECT CAST(COALESCE(SUM(matchId <= ?), 0) AS SIGNED) AS contados,
                CAST(COALESCE(SUM(matchId >  ?), 0) AS SIGNED) AS nuevos
           FROM vPlayedMatches
          WHERE tournamentId = ?`,
        [lastMatchId, lastMatchId, tournamentId],
      );

      return { contados: rows[0]?.contados ?? 0, nuevos: rows[0]?.nuevos ?? 0 };
    });
  }

  async findTournamentTable(tournamentId: number): Promise<unknown[]> {
    return this.db.callList('GetTournamentScoreboard', [tournamentId]);
  }

  async insertRanking(
    datos: DatosRanking,
    base: { rankingId: number; revision: number } | null,
  ): Promise<VersionRanking> {
    return this.db.withTransaction(async (conn) => {
      // La fila del TORNEO hace de mutex: una sola publicación por torneo a la vez.
      // No alcanza con bloquear las versiones: cuando todavía no hay ninguna, un
      // `FOR UPDATE` sobre un conjunto vacío toma locks de hueco que no se bloquean
      // entre sí, y dos inserciones simultáneas podían trabarse (1213) o pasar las
      // dos. Con el torneo bloqueado la segunda espera y después ve lo que dejó la
      // primera.
      await conn.execute(`SELECT tournamentId FROM Tournaments WHERE tournamentId = ? FOR UPDATE`, [
        datos.tournamentId,
      ]);

      const [vigentes] = await conn.execute<
        { rankingId: number; revision: number }[] & RowDataPacket[]
      >(
        `SELECT rankingId, revision
           FROM PoweradeRankings
          WHERE tournamentId = ?
          ORDER BY version DESC
          LIMIT 1`,
        [datos.tournamentId],
      );
      const vigente = vigentes[0] ?? null;

      // La base del borrador tiene que ser EXACTAMENTE la vigente de ahora. Si no,
      // otra conversación publicó en el medio y este borrador está viejo.
      const coincide =
        base === null
          ? vigente === null
          : vigente !== null &&
            vigente.rankingId === base.rankingId &&
            vigente.revision === base.revision;
      if (!coincide) throw new PoweradeConflictoError();

      const [filas] = await conn.execute<{ proxima: number }[] & RowDataPacket[]>(
        `SELECT COALESCE(MAX(version), 0) + 1 AS proxima
           FROM PoweradeRankings
          WHERE tournamentId = ?`,
        [datos.tournamentId],
      );

      const [resultado] = await conn.execute<ResultSetHeader>(
        `INSERT INTO PoweradeRankings (tournamentId, version, lastMatchId, model)
         VALUES (?, ?, ?, ?)`,
        [datos.tournamentId, filas[0]?.proxima ?? 1, datos.lastMatchId, datos.model],
      );

      await this.insertarEntradas(conn, resultado.insertId, datos);
      return this.leerVersion(conn, resultado.insertId);
    });
  }

  async replaceRanking(
    base: { rankingId: number; revision: number },
    datos: DatosRanking,
  ): Promise<VersionRanking> {
    return this.db.withTransaction(async (conn) => {
      // El UPDATE condicionado a la revisión ES la comprobación de concurrencia:
      // si otra conversación reemplazó entre medio, la revisión ya subió y no
      // coincide. Y como UPDATE toma el lock de la fila, dos reemplazos
      // simultáneos se serializan: el segundo ve la revisión nueva y no actualiza.
      const [resultado] = await conn.execute<ResultSetHeader>(
        `UPDATE PoweradeRankings
            SET lastMatchId = ?, model = ?, publishedAt = NOW(), revision = revision + 1
          WHERE rankingId = ? AND revision = ?`,
        [datos.lastMatchId, datos.model, base.rankingId, base.revision],
      );

      if (resultado.affectedRows === 0) throw new PoweradeConflictoError();

      await conn.execute(`DELETE FROM PoweradeEntries WHERE rankingId = ?`, [base.rankingId]);
      await this.insertarEntradas(conn, base.rankingId, datos);
      return this.leerVersion(conn, base.rankingId);
    });
  }

  // ─── Auxiliares ─────────────────────────────────────────────────────────────

  private async insertarEntradas(
    conn: PoolConnection,
    rankingId: number,
    datos: DatosRanking,
  ): Promise<void> {
    for (const [indice, entrada] of datos.entradas.entries()) {
      await conn.execute(
        `INSERT INTO PoweradeEntries (rankingId, position, playerId, reason)
         VALUES (?, ?, ?, ?)`,
        [rankingId, indice + 1, entrada.playerId, entrada.reason],
      );
    }
  }

  private async leerVersion(conn: PoolConnection, rankingId: number): Promise<VersionRanking> {
    const [versiones] = await conn.execute<VersionRowDB[] & RowDataPacket[]>(
      `SELECT rankingId, tournamentId, version, lastMatchId, revision, publishedAt
         FROM PoweradeRankings
        WHERE rankingId = ?`,
      [rankingId],
    );

    const [version] = await this.conEntradas(conn, versiones);
    if (!version) throw new Error(`La versión ${rankingId} no se pudo releer`);
    return version;
  }

  /** Trae las entradas de todas las versiones juntas y las une (ver el factory). */
  private async conEntradas(
    conn: PoolConnection,
    versiones: VersionRowDB[],
  ): Promise<VersionRanking[]> {
    if (versiones.length === 0) return [];

    const ids = versiones.map((v) => v.rankingId);
    const [entradas] = await conn.execute<EntryRowDB[] & RowDataPacket[]>(
      `SELECT e.rankingId, e.position, e.playerId, p.displayName, p.photo, p.cups, e.reason
         FROM PoweradeEntries e
         INNER JOIN vPlayerDetail p ON p.playerId = e.playerId
        WHERE e.rankingId IN (${ids.map(() => '?').join(', ')})
        ORDER BY e.rankingId, e.position`,
      ids,
    );

    return PoweradeFactory.toVersions(versiones, entradas);
  }
}
