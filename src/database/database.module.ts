import { Module } from '@nestjs/common';
import { GlobalsService } from '../globals/globals.service';
import { DATABASE_POOL } from './database.constants';
import { createDatabasePool } from './database.pool-factory';
import { DatabaseService } from './database.service';

/**
 * Provee el pool (token DATABASE_POOL) y el DatabaseService que lo envuelve.
 * Solo se exporta el service: nadie fuera de este modulo toca el pool crudo.
 */
@Module({
  providers: [
    {
      provide: DATABASE_POOL,
      useFactory: createDatabasePool,
      inject: [GlobalsService],
    },
    DatabaseService,
  ],
  exports: [DatabaseService],
})
export class DatabaseModule {}
