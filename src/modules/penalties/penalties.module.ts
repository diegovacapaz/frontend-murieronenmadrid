import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { PENALTIES_REPOSITORY } from './penalties.constants';
import { PenaltiesController } from './penalties.controller';
import { PenaltiesRepository } from './penalties.repository';
import { PenaltiesService } from './penalties.service';

@Module({
  imports: [DatabaseModule],
  controllers: [PenaltiesController],
  providers: [
    { provide: PENALTIES_REPOSITORY, useClass: PenaltiesRepository },
    PenaltiesService,
  ],
  exports: [PenaltiesService],
})
export class PenaltiesModule {}
