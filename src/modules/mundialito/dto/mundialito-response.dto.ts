import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EntityState } from '../../../common/enums/entity-state.enum';
import { MatchResult } from '../../matches/enums/match-result.enum';
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

  @ApiProperty({ description: 'Desempate del medallero: primero el que lo logro antes.' })
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

export class MundialitoBoardResponseDto {
  @ApiProperty({ type: [MundialitoMedalDto] })
  medalWinners!: MundialitoMedalDto[];

  @ApiProperty({
    type: [MundialitoBoardEntryDto],
    description: 'Ordenado por avance: campeon, despues los vivos, despues los eliminados.',
  })
  board!: MundialitoBoardEntryDto[];
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
}

export class MundialitoPhaseEliminationsDto {
  @ApiProperty()
  slot!: number;

  @ApiProperty({ enum: MundialitoPhase })
  phase!: MundialitoPhase;

  @ApiProperty()
  eliminations!: number;
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
}
