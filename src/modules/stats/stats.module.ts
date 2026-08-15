import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { STATS_REPOSITORY } from './stats.constants';
import { StatsController } from './stats.controller';
import { StatsRepository } from './stats.repository';
import { StatsService } from './stats.service';

@Module({
  imports: [DatabaseModule],
  controllers: [StatsController],
  providers: [{ provide: STATS_REPOSITORY, useClass: StatsRepository }, StatsService],
  exports: [StatsService],
})
export class StatsModule {}
