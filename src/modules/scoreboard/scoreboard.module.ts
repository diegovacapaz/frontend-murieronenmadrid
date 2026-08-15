import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { SCOREBOARD_REPOSITORY } from './scoreboard.constants';
import { ScoreboardController } from './scoreboard.controller';
import { ScoreboardRepository } from './scoreboard.repository';
import { ScoreboardService } from './scoreboard.service';

@Module({
  imports: [DatabaseModule],
  controllers: [ScoreboardController],
  providers: [
    { provide: SCOREBOARD_REPOSITORY, useClass: ScoreboardRepository },
    ScoreboardService,
  ],
  exports: [ScoreboardService],
})
export class ScoreboardModule {}
