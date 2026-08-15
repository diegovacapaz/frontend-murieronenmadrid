import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ApiRoute, ApiTag } from '../common/constants';
import { AuthService } from './auth.service';
import { Public } from './decorators/public.decorator';
import { LoginDto } from './dto/login.dto';
import { SessionResponseDto } from './dto/session-response.dto';

@ApiTags(ApiTag.AUTH)
@Controller(ApiRoute.AUTH)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Entrar en modo administracion',
    description:
      'Valida la clave de administracion y devuelve el token que habilita las ' +
      'operaciones de escritura. Leer no requiere token.',
  })
  @ApiResponse({ status: 401, description: 'Clave incorrecta' })
  login(@Body() loginDto: LoginDto): SessionResponseDto {
    return this.authService.login(loginDto);
  }

  @Get('session')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Verificar si el token sigue vigente',
    description:
      'Lo usa el frontend al recargar para saber si tiene que volver a pedir la ' +
      'clave o si puede seguir mostrando los controles de administracion.',
  })
  @ApiResponse({ status: 401, description: 'Token ausente, invalido o vencido' })
  session(@Headers('authorization') authorization?: string): { isAdmin: boolean } {
    // Es un GET, asi que el AdminGuard lo deja pasar sin token: la verificacion
    // la hace este handler a mano. Es intencional — la pregunta "sigo siendo
    // admin?" tiene que poder responderse con "no" (200 + isAdmin:false) y no
    // con un 401 que el interceptor de axios interpretaria como sesion caida.
    if (!authorization) {
      return { isAdmin: false };
    }

    const [scheme, token] = authorization.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) {
      return { isAdmin: false };
    }

    try {
      this.authService.verifyToken(token.trim());
      return { isAdmin: true };
    } catch {
      return { isAdmin: false };
    }
  }
}
