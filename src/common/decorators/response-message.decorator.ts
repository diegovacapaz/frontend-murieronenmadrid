import { SetMetadata } from '@nestjs/common';

export const RESPONSE_MESSAGE_KEY = 'responseMessage';

/**
 * Reemplaza el "Success" por defecto del envelope. Util cuando el mensaje
 * aporta algo ("Torneo finalizado") y no solo ruido.
 */
export const ResponseMessage = (message: string) =>
  SetMetadata(RESPONSE_MESSAGE_KEY, message);
