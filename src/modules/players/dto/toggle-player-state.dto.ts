import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty } from 'class-validator';
import { StatusAction } from '../../../common/enums/entity-state.enum';

export class TogglePlayerStateDto {
  @ApiProperty({
    enum: StatusAction,
    description:
      'activate lo habilita para ser convocado; deactivate lo saca de las ' +
      'convocatorias sin tocar su historial.',
  })
  @IsNotEmpty()
  @IsEnum(StatusAction)
  action!: StatusAction;
}
