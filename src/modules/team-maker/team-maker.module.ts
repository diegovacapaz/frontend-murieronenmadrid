import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { RealtimeService } from '../../realtime/realtime.service';
import type { ITeamMakerRepository } from './interfaces/team-maker.repository.interface';
import { TEAM_MAKER_REPOSITORY } from './team-maker.constants';
import { TeamMakerController } from './team-maker.controller';
import { TeamMakerGateway } from './team-maker.gateway';
import { TeamMakerRepository } from './team-maker.repository';
import { TeamMakerService } from './team-maker.service';

@Module({
  imports: [DatabaseModule],
  controllers: [TeamMakerController],
  providers: [
    { provide: TEAM_MAKER_REPOSITORY, useClass: TeamMakerRepository },
    {
      // Factory y no inyeccion por tipo: el service recibe reloj y azar
      // explicitos para poder testearlo con valores falsos (ver vitest.config).
      provide: TeamMakerService,
      useFactory: (repo: ITeamMakerRepository, realtime: RealtimeService) =>
        new TeamMakerService(
          repo,
          (event, payload) => realtime.emit(event, payload),
          {
            now: () => Date.now(),
            setTimeout: (fn, ms) => setTimeout(fn, ms),
            clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
          },
          Math.random,
        ),
      inject: [TEAM_MAKER_REPOSITORY, RealtimeService],
    },
    TeamMakerGateway,
  ],
})
export class TeamMakerModule {}
