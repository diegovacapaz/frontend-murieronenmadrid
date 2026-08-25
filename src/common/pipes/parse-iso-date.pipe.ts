import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { AppErrorCode } from '../constants/error-codes.constants';

/** YYYY-MM-DD y nada más. Ni ISO con hora, ni fechas sueltas de un dígito. */
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Valida un parámetro de ruta con forma de fecha ISO y lo deja pasar como
 * string.
 *
 * Existe para que `/editions/pepe` muera acá y no en la base: sin el pipe, ese
 * valor llega a un `WHERE publishedOn = ?` y MySQL lo resuelve como una
 * comparación que nunca matchea, así que el usuario recibiría un 404 en vez de
 * un "eso no es una fecha".
 *
 * No devuelve un `Date` a propósito: las fechas de este módulo son días de
 * calendario (columnas DATE), y convertirlas a Date les inventa una hora y una
 * zona que después hay que volver a sacar.
 */
@Injectable()
export class ParseIsoDatePipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (typeof value !== 'string' || !ISO_DATE_REGEX.test(value)) {
      throw new BadRequestException({
        message: 'Date must be in YYYY-MM-DD format',
        errorCode: AppErrorCode.VALIDATION_FAILED,
      });
    }

    return value;
  }
}
