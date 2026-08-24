/**
 * El modelo no produjo una edición usable: se agotaron los turnos, terminó sin
 * llamar a la herramienta, o lo que mandó no pasó la validación.
 *
 * No es una excepción de Nest a propósito: nadie está esperando una respuesta
 * HTTP cuando esto pasa a las cinco de la mañana. La atrapa el cron, la loguea
 * y reintenta una vez.
 */
export class NewsletterGenerationError extends Error {
  constructor(motivo: string) {
    super(motivo);
    this.name = 'NewsletterGenerationError';
  }
}
