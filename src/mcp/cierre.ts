/** Cualquier cosa que se cierra devolviendo una promesa: el `McpServer` y el transporte. */
export interface Cerrable {
  close(): Promise<void>;
}

/**
 * Cierra todo lo que recibe sin que un fallo al cerrar pueda tirar el proceso.
 *
 * El cierre se dispara desde el evento `close` de la respuesta, donde nadie
 * espera la promesa. Un `void x.close()` a secas deja un rechazo sin manejar si
 * `close` falla —por ejemplo un doble cierre en una versión futura del SDK— y
 * desde Node 15 un rechazo sin manejar **mata el proceso**, o sea la API entera
 * del sitio por un detalle del MCP. Acá se atrapa tanto el rechazo como el
 * lanzamiento síncrono, y un cerrable que falla no impide cerrar los demás.
 *
 * No se loguea el motivo a propósito: lo que le interesa a nadie es que no se
 * caiga, y un mensaje de error del SDK podría arrastrar datos del pedido.
 */
export function cerrarEnSilencio(...cerrables: Cerrable[]): void {
  for (const cerrable of cerrables) {
    try {
      cerrable.close().catch(() => undefined);
    } catch {
      // Lanzó de forma síncrona: ya está atrapado, y se sigue con el siguiente.
    }
  }
}
