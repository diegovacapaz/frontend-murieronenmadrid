import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { PLAYERS_REPOSITORY } from './players.constants';
import { PlayersController } from './players.controller';
import { PlayersRepository } from './players.repository';
import { PlayersService } from './players.service';

@Module({
  imports: [DatabaseModule],
  controllers: [PlayersController],
  providers: [
    { provide: PLAYERS_REPOSITORY, useClass: PlayersRepository },
    PlayersService,
  ],
  exports: [PlayersService],
})
export class PlayersModule {}
