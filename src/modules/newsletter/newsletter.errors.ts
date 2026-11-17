import { ErrorParaElRedactor } from '../../mcp/errores';

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

/**
 * Un error de negocio del MCP del diario: lo que le pasa a quien está escribiendo
 * la edición y puede corregir. Ver `ErrorParaElRedactor` para las reglas del
 * mensaje: lo lee un modelo y no puede arrastrar detalles internos.
 */
export class NewsletterMcpError extends ErrorParaElRedactor {
  constructor(mensajeParaElRedactor: string) {
    super(mensajeParaElRedactor);
    this.name = 'NewsletterMcpError';
  }
}
