import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EntityState } from '../../../common/enums/entity-state.enum';
import { MatchResult } from '../../matches/enums/match-result.enum';
import { Team } from '../../teams/enums/team.enum';
import {
  MundialitoHighlightKind,
  MundialitoRecordKind,
} from '../entities/mundialito.entity';
import { MundialitoPhase, MundialitoStatus } from '../enums/mundialito.enums';

export class MundialitoBallDto {
  @ApiProperty({ description: 'Puesto dentro del mundialito, de 1 a 8.' })
  slot!: number;

  @ApiProperty({ enum: MundialitoPhase })
  phase!: MundialitoPhase;

  @ApiProperty({ enum: MatchResult })
  result!: MatchResult;

  @ApiProperty({ description: 'Puntos del mundialito: 3, 1 o 0.' })
  points!: number;

  @ApiProperty()
  matchId!: number;

  @ApiProperty({ description: 'ISO con Z, formateada en la vista.' })
  playedAt!: string;

  @ApiProperty({ description: 'Diferencia de gol con signo desde este jugador.' })
  goalsDiference!: number;

  @ApiProperty({ enum: Team })
  team!: Team;
}

export class MundialitoRunDto {
  @ApiProperty()
  playerId!: number;

  @ApiProperty({ description: 'Numero de mundialito del jugador; el primero es 1.' })
  runIndex!: number;

  @ApiProperty({ description: 'Partidos jugados de los ocho.' })
  played!: number;

  @ApiProperty({ description: 'Puntos de la fase de grupos. Se congela al clasificar.' })
  groupPoints!: number;

  @ApiProperty({ description: 'Puntos de toda la corrida.' })
  points!: number;

  @ApiProperty()
  firstPlayedAt!: Date;

  @ApiProperty({ enum: MundialitoStatus })
  status!: MundialitoStatus;

  @ApiProperty({ enum: MundialitoPhase, description: 'Fase del ultimo partido jugado.' })
  phase!: MundialitoPhase;

  @ApiProperty({ description: 'Puesto del proximo partido; 1 si la corrida ya cerro.' })
  nextSlot!: number;

  @ApiProperty()
  lastPlayedAt!: Date;

  @ApiProperty({ type: [MundialitoBallDto] })
  balls!: MundialitoBallDto[];
}

class MundialitoPlayerDto {
  @ApiProperty()
  playerId!: number;

  @ApiProperty()
  displayName!: string;

  @ApiPropertyOptional({ nullable: true })
  nickname!: string | null;

  @ApiPropertyOptional({ nullable: true })
  photo!: string | null;

  @ApiProperty({ enum: EntityState })
  playerState!: EntityState;

  @ApiProperty()
  isSagrado!: boolean;

  @ApiProperty({ description: 'Torneos ganados. El mundialito no suma acá.' })
  cups!: number;
}

export class MundialitoMedalDto extends MundialitoPlayerDto {
  @ApiProperty()
  position!: number;

  @ApiProperty({ description: 'Mundialitos ganados.' })
  titles!: number;

  @ApiProperty({ description: 'Finales perdidas.' })
  runnerUps!: number;

  @ApiProperty({ description: 'Semifinales jugadas.' })
  semis!: number;

  @ApiProperty({ description: 'Ultimo escalon del desempate: quien lo consiguio antes.' })
  firstTitleAt!: Date;

  @ApiProperty()
  lastTitleAt!: Date;
}

export class MundialitoBoardEntryDto extends MundialitoPlayerDto {
  @ApiProperty({ description: 'Mundialitos ganados.' })
  titles!: number;

  @ApiProperty({ type: MundialitoRunDto })
  run!: MundialitoRunDto;
}

export class MundialitoPhaseEliminationsDto {
  @ApiProperty()
  slot!: number;

  @ApiProperty({ enum: MundialitoPhase })
  phase!: MundialitoPhase;

  @ApiProperty()
  eliminations!: number;
}

export class MundialitoGlobalSummaryDto {
  @ApiProperty({ description: 'Corridas terminadas. La que se esta jugando no cuenta.' })
  runsEnded!: number;

  @ApiProperty()
  titles!: number;

  @ApiPropertyOptional({ nullable: true, description: 'titles / runsEnded.' })
  coronationRate!: number | null;

  @ApiProperty()
  qualified!: number;

  @ApiPropertyOptional({ nullable: true })
  qualifiedRate!: number | null;

  @ApiPropertyOptional({ nullable: true, description: 'Partidos que dura un mundialito.' })
  avgRunLength!: number | null;

  @ApiProperty({ description: 'Jugadores con al menos una corrida terminada.' })
  players!: number;

  @ApiProperty()
  aliveNow!: number;

  @ApiProperty({ description: 'De los vivos, cuantos ya estan en eliminacion directa.' })
  inKnockoutNow!: number;

  @ApiProperty({ description: 'Mundialitos ganados con los ocho partidos.' })
  perfectRuns!: number;
}

export class MundialitoPerformanceDto extends MundialitoPlayerDto {
  @ApiProperty()
  position!: number;

  @ApiProperty()
  runsPlayed!: number;

  @ApiProperty()
  runsEnded!: number;

  @ApiProperty()
  qualified!: number;

  @ApiPropertyOptional({ nullable: true, description: 'null si no termino ninguna corrida.' })
  qualifiedRate!: number | null;

  @ApiPropertyOptional({ nullable: true })
  avgRunLength!: number | null;

  @ApiProperty()
  koPlayed!: number;

  @ApiProperty()
  koPassed!: number;

  @ApiPropertyOptional({ nullable: true })
  koRate!: number | null;

  @ApiProperty()
  semis!: number;

  @ApiProperty()
  finals!: number;

  @ApiProperty()
  titles!: number;

  @ApiProperty()
  bestSlot!: number;

  @ApiProperty({ description: 'Corridas terminadas seguidas sin pasar de grupos.' })
  droughtRuns!: number;
}

export class MundialitoRecordDto {
  @ApiProperty({ enum: MundialitoRecordKind })
  kind!: MundialitoRecordKind;

  @ApiProperty()
  playerId!: number;

  @ApiProperty()
  displayName!: string;

  @ApiPropertyOptional({ nullable: true })
  photo!: string | null;

  @ApiProperty()
  value!: number;
}

export class MundialitoBoardResponseDto {
  @ApiProperty({ type: [MundialitoMedalDto] })
  medalWinners!: MundialitoMedalDto[];

  @ApiProperty({
    type: [MundialitoBoardEntryDto],
    description: 'Ordenado por avance: campeon, despues los vivos, despues los eliminados.',
  })
  board!: MundialitoBoardEntryDto[];

  @ApiProperty({ type: MundialitoGlobalSummaryDto })
  summary!: MundialitoGlobalSummaryDto;

  @ApiProperty({
    type: [MundialitoPerformanceDto],
    description: 'Rendimiento historico, ordenado por titulos, finales y semis.',
  })
  performance!: MundialitoPerformanceDto[];

  @ApiProperty({
    type: [MundialitoPhaseEliminationsDto],
    description: 'En que fase se muere el grupo entero.',
  })
  eliminationsByPhase!: MundialitoPhaseEliminationsDto[];

  @ApiProperty({ type: [MundialitoRecordDto] })
  records!: MundialitoRecordDto[];
}

export class MundialitoSummaryDto {
  @ApiProperty()
  playerId!: number;

  @ApiProperty({ description: 'Partidos de torneos con detalle registrado.' })
  matchesPlayed!: number;

  @ApiProperty({ description: 'Mundialitos corridos, incluido el vigente.' })
  runsPlayed!: number;

  @ApiProperty()
  titles!: number;

  @ApiProperty()
  eliminations!: number;

  @ApiProperty({ description: 'Puesto mas alto jugado. 8 significa que jugo una final.' })
  bestSlot!: number;

  @ApiProperty({ description: 'Corridas terminadas: el denominador de los porcentajes.' })
  runsEnded!: number;

  @ApiProperty()
  qualified!: number;

  @ApiPropertyOptional({ nullable: true })
  qualifiedRate!: number | null;

  @ApiPropertyOptional({ nullable: true })
  avgRunLength!: number | null;

  @ApiProperty()
  koPlayed!: number;

  @ApiProperty()
  koPassed!: number;

  @ApiPropertyOptional({ nullable: true })
  koRate!: number | null;

  @ApiProperty()
  semis!: number;

  @ApiProperty()
  finals!: number;

  @ApiProperty({ description: 'Corridas terminadas seguidas sin pasar de grupos.' })
  droughtRuns!: number;

  @ApiProperty()
  perfectRuns!: number;
}

export class MundialitoHighlightDto {
  @ApiProperty({ enum: MundialitoHighlightKind })
  kind!: MundialitoHighlightKind;

  @ApiProperty()
  playerId!: number;

  @ApiProperty()
  displayName!: string;

  @ApiPropertyOptional({ nullable: true })
  photo!: string | null;

  @ApiProperty({ description: 'Veces que estuvo del otro lado en la eliminacion.' })
  times!: number;

  @ApiProperty({ description: 'Cruces totales entre los dos, para leer el numero.' })
  played!: number;
}

export class PlayerMundialitoResponseDto {
  @ApiProperty({ type: MundialitoSummaryDto })
  summary!: MundialitoSummaryDto;

  @ApiPropertyOptional({
    type: MundialitoRunDto,
    nullable: true,
    description: 'null si el jugador todavia no jugo ningun partido elegible.',
  })
  current!: MundialitoRunDto | null;

  @ApiProperty({
    type: [MundialitoPhaseEliminationsDto],
    description: 'Las seis fases siempre presentes, con cero si nunca se murio ahi.',
  })
  eliminationsByPhase!: MundialitoPhaseEliminationsDto[];

  @ApiProperty({
    type: [MundialitoHighlightDto],
    description: 'Verdugo y victima. Cero, una o dos filas segun quien supere el minimo.',
  })
  highlights!: MundialitoHighlightDto[];

  @ApiPropertyOptional({
    type: MundialitoRunDto,
    nullable: true,
    description:
      'El mejor mundialito que corrio: ganado antes que largo, largo antes que puntudo.',
  })
  bestRun!: MundialitoRunDto | null;
}
