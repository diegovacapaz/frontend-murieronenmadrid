import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { MATCHES_REPOSITORY } from './matches.constants';
import { MatchesController } from './matches.controller';
import { MatchesRepository } from './matches.repository';
import { MatchesService } from './matches.service';

@Module({
  imports: [DatabaseModule],
  controllers: [MatchesController],
  providers: [
    { provide: MATCHES_REPOSITORY, useClass: MatchesRepository },
    MatchesService,
  ],
  exports: [MatchesService],
})
export class MatchesModule {}
