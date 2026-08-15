import type { TransformFnParams } from 'class-transformer';

/**
 * Convierte un valor de querystring a boolean opcional.
 *
 * Todo lo que llega por la URL es string: sin esto, `?isSagrado=false` seria el
 * string "false", que en JavaScript es truthy, y el filtro devolveria
 * exactamente lo contrario de lo pedido. Un bug silencioso y molesto de
 * encontrar.
 *
 * `undefined` se preserva para que @IsOptional distinga "no filtres" de
 * "filtra por false".
 */
export function toOptionalBoolean({ value }: TransformFnParams): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  return undefined;
}
