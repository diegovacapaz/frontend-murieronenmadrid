import type { EntradaRanking, VersionRanking } from '../entities/powerade.entity';
import type { EntryRowDB, VersionRowDB } from '../interfaces/database';

/**
 * Arma las versiones del ranking desde las filas de la base.
 *
 * El repositorio trae las versiones en una consulta y las entradas de TODAS en
 * otra, y acá se unen en memoria: pedir las entradas versión por versión sería
 * una consulta por cada una.
 */
export class PoweradeFactory {
  /**
   * Conserva el orden en que llegan las versiones (el repositorio las pide de la
   * más nueva a la más vieja) y ordena las entradas de cada una por puesto.
   */
  static toVersions(versiones: VersionRowDB[], entradas: EntryRowDB[]): VersionRanking[] {
    const porVersion = new Map<number, EntradaRanking[]>();

    for (const fila of entradas) {
      const lista = porVersion.get(fila.rankingId) ?? [];
      lista.push(PoweradeFactory.toEntry(fila));
      porVersion.set(fila.rankingId, lista);
    }

    return versiones.map((fila) => ({
      rankingId: fila.rankingId,
      tournamentId: fila.tournamentId,
      version: fila.version,
      lastMatchId: fila.lastMatchId,
      revision: fila.revision,
      // La columna es DATETIME y el pool la entrega como Date en UTC. Sale como
      // string con sufijo Z, que es la convención de fechas de toda la API.
      publishedAt: fila.publishedAt.toISOString(),
      entries: (porVersion.get(fila.rankingId) ?? []).sort((a, b) => a.position - b.position),
    }));
  }

  private static toEntry(fila: EntryRowDB): EntradaRanking {
    return {
      position: fila.position,
      playerId: fila.playerId,
      displayName: fila.displayName,
      photo: fila.photo,
      cups: fila.cups,
      reason: fila.reason,
    };
  }
}
