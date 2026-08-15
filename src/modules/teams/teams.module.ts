import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { TEAMS_REPOSITORY } from './teams.constants';
import { TeamsController } from './teams.controller';
import { TeamsRepository } from './teams.repository';
import { TeamsService } from './teams.service';

@Module({
  imports: [DatabaseModule],
  controllers: [TeamsController],
  providers: [{ provide: TEAMS_REPOSITORY, useClass: TeamsRepository }, TeamsService],
  exports: [TeamsService],
})
export class TeamsModule {}
