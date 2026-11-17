import { Inject, Injectable } from '@nestjs/common';
import type { PoweradeResponseDto } from './dto/powerade-response.dto';
import { calcularMovimientos } from './helpers/movimientos';
import type { IPoweradeRepository } from './interfaces/powerade.repository.interface';
import { POWERADE_REPOSITORY, PUESTOS } from './powerade.constants';

/**
 * La lectura pública del ranking. Quién escribe es el servicio MCP; acá sólo se
 * decide qué mostrar.
 */
@Injectable()
export class PoweradeService {
  constructor(
    @Inject(POWERADE_REPOSITORY)
    private readonly poweradeRepository: IPoweradeRepository,
  ) {}

  /**
   * El ranking vigente de un torneo, o `null` cuando no corresponde mostrar nada.
   *
   * **La regla "si el torneo terminó no aparece" vive sólo acá.** El frontend no
   * la repite: con dos fuentes de verdad, un torneo que termina podría seguir
   * mostrando la tarjeta en una pantalla y no en otra.
   *
   * `null` en cuatro casos, y ninguno es un error: el torneo no existe, no está
   * en juego (o no tiene detalle de partidos, y sin marcadores no hay con qué
   * juzgar), todavía no se publicó ninguna versión, o la versión vigente quedó
   * con menos de tres puestos porque se borró un jugador. En ese último caso una
   * tarjeta con dos puestos parecería rota; se oculta hasta que se publique una
   * versión nueva.
   */
  async findByTournament(tournamentId: number): Promise<PoweradeResponseDto | null> {
    const torneo = await this.poweradeRepository.findTournament(tournamentId);
    if (!torneo || torneo.state !== 'P' || !torneo.wasTracked) return null;

    // Las dos últimas: la vigente se muestra y la anterior es contra lo que se
    // calculan las flechas.
    const [vigente, anterior] = await this.poweradeRepository.findLatestVersions(tournamentId, 2);
    if (!vigente || vigente.entries.length < PUESTOS) return null;

    const movimientos = calcularMovimientos(vigente.entries, anterior?.entries ?? null);
    const { contados, nuevos } = await this.poweradeRepository.countMatches(
      tournamentId,
      vigente.lastMatchId,
    );

    return {
      version: vigente.version,
      lastMatchId: vigente.lastMatchId,
      publishedAt: vigente.publishedAt,
      partidosContados: contados,
      partidosNuevos: nuevos,
      entries: vigente.entries.map((entrada, indice) => ({
        ...entrada,
        movement: movimientos[indice] ?? null,
      })),
    };
  }
}
