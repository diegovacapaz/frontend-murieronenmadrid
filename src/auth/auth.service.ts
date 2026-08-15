import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService, TokenExpiredError, type JwtSignOptions } from '@nestjs/jwt';
import { timingSafeEqual } from 'node:crypto';
import { AppErrorCode } from '../common/constants/error-codes.constants';
import { GlobalsService } from '../globals/globals.service';
import { LoginDto } from './dto/login.dto';
import { SessionResponseDto } from './dto/session-response.dto';

/** Lo unico que lleva el token: que es de admin y cuando se emitio. */
interface AdminTokenPayload {
  scope: 'admin';
  iat?: number;
  exp?: number;
}

/**
 * Autenticacion del sistema, entera.
 *
 * No hay usuarios: hay UNA clave de administracion en la .env. Quien la manda
 * recibe un token firmado; quien tiene el token puede escribir. El resto del
 * mundo lee.
 *
 * Es el mismo modelo del sistema original (un password en Script Properties y
 * un token en cache), con dos mejoras: el token es un JWT firmado —asi no hace
 * falta guardar sesiones en memoria y sobrevive a un reinicio o a varias
 * instancias detras de un balanceador— y la comparacion de la clave es en
 * tiempo constante.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly globals: GlobalsService,
  ) {}

  login(dto: LoginDto): SessionResponseDto {
    if (!this.isValidPassword(dto.password)) {
      // Sin detalle de por que fallo: no hay usuario que enumerar, pero
      // tampoco hace falta confirmarle a nadie que la clave "existe pero es
      // otra". El log queda del lado del servidor.
      this.logger.warn('Intento de login con clave incorrecta');
      throw new UnauthorizedException({
        message: 'Invalid admin password',
        errorCode: AppErrorCode.AUTH_INVALID_PASSWORD,
      });
    }

    const expiresIn = this.globals.get('ADMIN_TOKEN_EXPIRES_IN');

    // El cast es al tipo de la propia libreria, que es un template literal
    // (`${number}h` y compania). El formato ya lo garantiza el @Matches de
    // EnvironmentVariables, asi que aca no hay nada mas que verificar.
    const token = this.jwtService.sign({ scope: 'admin' } satisfies AdminTokenPayload, {
      expiresIn: expiresIn as JwtSignOptions['expiresIn'],
    });

    return { token, expiresIn, isAdmin: true };
  }

  /**
   * Valida un token y devuelve su payload. Lanza 401 con el codigo que
   * corresponde: vencido e invalido son cosas distintas para el frontend
   * (vencido = volve a entrar; invalido = algo raro pasa).
   */
  verifyToken(token: string): AdminTokenPayload {
    try {
      return this.jwtService.verify<AdminTokenPayload>(token);
    } catch (error) {
      if (error instanceof TokenExpiredError) {
        throw new UnauthorizedException({
          message: 'Admin session expired',
          errorCode: AppErrorCode.AUTH_TOKEN_EXPIRED,
        });
      }
      throw new UnauthorizedException({
        message: 'Invalid admin token',
        errorCode: AppErrorCode.AUTH_TOKEN_INVALID,
      });
    }
  }

  /**
   * Comparacion en tiempo constante.
   *
   * `===` sobre strings corta en el primer caracter distinto, y esa diferencia
   * de tiempo es medible: sirve para adivinar la clave caracter por caracter.
   * timingSafeEqual siempre recorre todo el buffer.
   *
   * Exige buffers del mismo largo, asi que el largo distinto se resuelve antes
   * — y ahi si hay una fuga de informacion, pero solo del LARGO de la clave, no
   * de su contenido.
   */
  private isValidPassword(candidate: string): boolean {
    const expected = Buffer.from(this.globals.get('ADMIN_PASSWORD'), 'utf8');
    const received = Buffer.from(candidate, 'utf8');

    if (expected.length !== received.length) {
      return false;
    }

    return timingSafeEqual(expected, received);
  }
}
