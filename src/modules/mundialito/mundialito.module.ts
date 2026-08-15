import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { MUNDIALITO_REPOSITORY } from './mundialito.constants';
import { MundialitoController } from './mundialito.controller';
import { MundialitoRepository } from './mundialito.repository';
import { MundialitoService } from './mundialito.service';

@Module({
  imports: [DatabaseModule],
  controllers: [MundialitoController],
  providers: [
    { provide: MUNDIALITO_REPOSITORY, useClass: MundialitoRepository },
    MundialitoService,
  ],
  exports: [MundialitoService],
})
export class MundialitoModule {}
