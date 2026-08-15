import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { TOURNAMENTS_REPOSITORY } from './tournaments.constants';
import { TournamentsController } from './tournaments.controller';
import { TournamentsRepository } from './tournaments.repository';
import { TournamentsService } from './tournaments.service';

@Module({
  imports: [DatabaseModule],
  controllers: [TournamentsController],
  providers: [
    { provide: TOURNAMENTS_REPOSITORY, useClass: TournamentsRepository },
    TournamentsService,
  ],
  exports: [TournamentsService],
})
export class TournamentsModule {}
