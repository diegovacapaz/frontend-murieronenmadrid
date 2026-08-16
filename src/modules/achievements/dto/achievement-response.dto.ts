import { ApiProperty } from '@nestjs/swagger';
import { AchievementCategory, AchievementState } from '../enums/achievement.enums';

export class AchievementDto {
  @ApiProperty({ description: 'Identificador del logro en el catalogo.', example: 'CAZADOR' })
  code!: string;

  @ApiProperty({ enum: AchievementCategory })
  category!: AchievementCategory;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  description!: string;

  @ApiProperty({ description: 'Si es una maldicion, es decir, si puede romperse.' })
  isBreakable!: boolean;

  @ApiProperty({ enum: AchievementState })
  state!: AchievementState;

  @ApiProperty({
    nullable: true,
    description: 'Cuanto lleva. Null en los logros de evento, que no tienen progreso parcial.',
  })
  progress!: number | null;

  @ApiProperty({ nullable: true, description: 'Cuanto necesita para conseguirlo.' })
  target!: number | null;
}

export class AchievementCountDto {
  @ApiProperty({ description: 'Obtenidos. Los rotos no cuentan.' })
  obtained!: number;

  @ApiProperty()
  total!: number;
}

export class AchievementSummaryDto {
  @ApiProperty({ type: AchievementCountDto })
  all!: AchievementCountDto;

  @ApiProperty({
    type: AchievementCountDto,
    isArray: false,
    description: 'Contadores por categoria, indexados por su letra: G, S y M.',
  })
  byCategory!: Record<AchievementCategory, AchievementCountDto>;
}

export class PlayerAchievementsResponseDto {
  @ApiProperty({ type: AchievementDto, isArray: true })
  achievements!: AchievementDto[];

  @ApiProperty({ type: AchievementSummaryDto })
  summary!: AchievementSummaryDto;
}
