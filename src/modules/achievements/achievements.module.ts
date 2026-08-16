import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { ACHIEVEMENTS_REPOSITORY } from './achievements.constants';
import { AchievementsController } from './achievements.controller';
import { AchievementsRepository } from './achievements.repository';
import { AchievementsService } from './achievements.service';

@Module({
  imports: [DatabaseModule],
  controllers: [AchievementsController],
  providers: [
    { provide: ACHIEVEMENTS_REPOSITORY, useClass: AchievementsRepository },
    AchievementsService,
  ],
  exports: [AchievementsService],
})
export class AchievementsModule {}
