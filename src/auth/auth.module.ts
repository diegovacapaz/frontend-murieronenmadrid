import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { GlobalsService } from '../globals/globals.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

/**
 * @Global porque el AdminGuard se registra como guard global en AppModule y
 * necesita al AuthService inyectado: sin esto habria que importar AuthModule
 * desde AppModule solo para satisfacer al contenedor.
 */
@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [GlobalsService],
      useFactory: (globals: GlobalsService) => ({
        secret: globals.get('ADMIN_TOKEN_SECRET'),
        signOptions: { algorithm: 'HS256' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
