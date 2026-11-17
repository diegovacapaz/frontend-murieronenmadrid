/**
 * Un error de negocio de una herramienta MCP: lo que le pasa a quien está
 * escribiendo y puede corregir.
 *
 * **El `message` lo lee un modelo**, no una persona: está en castellano, dice qué
 * falló y qué hacer (por ejemplo, volver a llamar a `diario_iniciar`), y nunca
 * arrastra un detalle interno —un mensaje de MySQL, una ruta— porque la capa de
 * herramientas se lo entrega tal cual al cliente.
 *
 * Es la base común de los errores de cada producto (el diario, el Powerade):
 * `aResultadoDeHerramienta` reconoce a todos por esta clase y no necesita saber
 * cuántos productos hay.
 */
export class ErrorParaElRedactor extends Error {
  constructor(mensajeParaElRedactor: string) {
    super(mensajeParaElRedactor);
    this.name = 'ErrorParaElRedactor';
  }
}
