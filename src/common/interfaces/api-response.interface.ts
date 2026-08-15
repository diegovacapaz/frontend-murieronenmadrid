/**
 * Metadata que acompania a `data` sin ensuciarla.
 *
 * Deliberadamente abierta: hoy ningun endpoint pagina, pero cualquiera puede
 * adjuntar la suya con `WithMeta` sin cambiar el envelope ni romper a los
 * consumidores existentes.
 */
export interface ResponseMeta {
  [key: string]: unknown;
}

/**
 * Envelope unico de TODA respuesta de la API — exitos y errores.
 * Lo aplica ApiResponseInterceptor.
 */
export interface ApiResponse<T> {
  statusCode: number;
  message: string;
  data?: T;
  /** Solo presente cuando el endpoint aporta metadata. */
  meta?: ResponseMeta;
  error?: string | string[];
  /** Clave de i18n para que el frontend traduzca el error al idioma del usuario. */
  errorCode?: string;
  timestamp: string;
}
