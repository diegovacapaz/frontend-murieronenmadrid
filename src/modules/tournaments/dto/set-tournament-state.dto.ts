import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty } from 'class-validator';
import { TournamentStateAction } from '../enums/tournament-state.enum';

export class SetTournamentStateDto {
  @ApiProperty({
    enum: TournamentStateAction,
    description:
      'finish cierra el torneo y consagra al campeon; reopen lo vuelve a ' +
      'habilitar para cargar o corregir partidos.',
  })
  @IsNotEmpty()
  @IsEnum(TournamentStateAction)
  action!: TournamentStateAction;
}
