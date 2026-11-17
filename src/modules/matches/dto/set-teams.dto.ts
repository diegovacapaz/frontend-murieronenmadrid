import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsEnum, IsInt, Min, ValidateNested } from 'class-validator';
import { Team } from '../../teams/enums/team.enum';

export class TeamAssignmentDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  playerId!: number;

  @ApiProperty({ enum: Team })
  @IsEnum(Team)
  team!: Team;
}

export class GuestTeamAssignmentDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  guestId!: number;

  @ApiProperty({ enum: Team })
  @IsEnum(Team)
  team!: Team;
}

/**
 * Armar los equipos a mano. No cambia quienes van: tienen que venir
 * exactamente los convocados y los randoms que el partido ya tiene.
 */
export class SetTeamsDto {
  @ApiProperty({ type: [TeamAssignmentDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => TeamAssignmentDto)
  players!: TeamAssignmentDto[];

  @ApiProperty({ type: [GuestTeamAssignmentDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GuestTeamAssignmentDto)
  guests!: GuestTeamAssignmentDto[];
}
