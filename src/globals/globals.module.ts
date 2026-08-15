import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { join } from 'path';
import { validate } from './env.validation';
import { GlobalsService } from './globals.service';

/**
 * @Global: la configuracion la necesita medio sistema (pool de base, guard de
 * admin, CORS, gateway de sockets). Declararla global evita importar este
 * modulo en cada feature module solo para leer una variable.
 */
@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: join(process.cwd(), '.env'),
      validate,
    }),
  ],
  providers: [GlobalsService],
  exports: [GlobalsService],
})
export class GlobalsModule {}
