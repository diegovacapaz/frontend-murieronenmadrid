import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EntityState } from '../../../common/enums/entity-state.enum';

export class PlayerChampionshipDto {
  @ApiProperty()
  tournamentId!: number;

  @ApiProperty({ example: 'Clausura 2025' })
  name!: string;
}

export class PlayerResponseDto {
  @ApiProperty()
  playerId!: number;

  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  secondName!: string;

  @ApiPropertyOptional({ nullable: true })
  nickname!: string | null;

  @ApiProperty({
    description: 'El apodo si lo tiene, si no nombre y apellido. Es lo que se muestra.',
  })
  displayName!: string;

  @ApiPropertyOptional({ nullable: true })
  photo!: string | null;

  @ApiProperty({ enum: EntityState })
  state!: EntityState;

  @ApiProperty()
  isSagrado!: boolean;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty({ description: 'Torneos ganados. Calculado en la base en cada lectura.' })
  cups!: number;

  @ApiProperty({ type: [PlayerChampionshipDto], description: 'Cuales torneos gano.' })
  championships!: PlayerChampionshipDto[];
}
