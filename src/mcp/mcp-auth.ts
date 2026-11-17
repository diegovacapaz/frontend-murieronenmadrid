import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';

/**
 * Saca la clave del MCP de un pedido. Se acepta de tres maneras, en este orden
 * de prioridad:
 *
 *   1. `Authorization: Bearer <clave>` — lo que mandan los clientes que dejan
 *      poner headers (Claude Code, otros).
 *   2. `X-API-Key: <clave>` — la otra convención habitual para claves fijas.
 *   3. La primera parte de la ruta: `/mcp/<clave>`. Es la que hace falta para el
 *      conector de claude.ai, porque los headers fijos de ese diálogo son una
 *      beta que sólo tienen algunas organizaciones.
 *
 * `rutaRestante` es `req.url` tal como le llega a un middleware montado en
 * `/mcp`: Express ya le sacó el prefijo, así que es `'/'`, `'/<clave>'` o
 * `'/<clave>?x=1'`.
 *
 * La clave de la ruta es base64url, o sea que no necesita decodificarse.
 */
export function extraerClave(headers: IncomingHttpHeaders, rutaRestante: string): string | null {
  const autorizacion = headers.authorization;
  if (autorizacion) {
    const [esquema, valor] = autorizacion.split(' ');
    if (esquema?.toLowerCase() === 'bearer' && valor) return valor.trim();
  }

  const xApiKey = headers['x-api-key'];
  if (typeof xApiKey === 'string' && xApiKey !== '') return xApiKey;

  const sinQuery = rutaRestante.split('?')[0] ?? '';
  const segmento = sinQuery.split('/').find((parte) => parte !== '');
  return segmento ?? null;
}

/**
 * ¿La clave que vino es la configurada?
 *
 * Se comparan los SHA-256 de las dos y no las cadenas: `timingSafeEqual` exige
 * buffers del mismo largo y lanza si no lo son, y la alternativa —chequear el
 * largo antes— le diría a quien prueba cuántos caracteres tiene la clave. Con
 * los hashes el largo siempre es 32.
 *
 * Una clave esperada vacía no acepta nada: es el estado de "MCP apagado" y no
 * puede convertirse en "cualquiera entra con una cadena vacía".
 */
export function claveValida(candidata: string | null, esperada: string): boolean {
  if (candidata === null || esperada === '') return false;

  const a = createHash('sha256').update(candidata).digest();
  const b = createHash('sha256').update(esperada).digest();
  return timingSafeEqual(a, b);
}

/**
 * La URL de un pedido con la clave tapada, para poder loguearla.
 *
 * La clave puede venir en la ruta (`/mcp/<clave>`), así que **ninguna URL se
 * loguea sin pasar por acá**. Tapa el primer segmento después de `/mcp/` y deja
 * el resto: el query string y cualquier ruta que venga detrás son justo lo que
 * hace falta ver cuando un cliente no logra conectar.
 */
export function redactarUrl(url: string): string {
  return url.replace(/^(\/mcp\/)[^/?]+/i, '$1[clave]');
}

export type Acceso = 'permitir' | 'rechazar' | 'frenar';

/**
 * Qué hacer con un pedido, dado si la clave es válida y si su IP está bloqueada.
 *
 * **Una clave válida pasa SIEMPRE, aunque la IP esté bloqueada.** Detrás de un
 * túnel o un proxy `req.ip` es el de ese intermediario, o sea que todos los
 * clientes comparten contador: si el bloqueo se chequeara antes que la clave,
 * cualquier bot que mande diez pedidos malos al túnel dejaría a claude.ai con
 * 429 durante un minuto. Con una clave aleatoria de 32 caracteres o más, adivinarla
 * no es realista, así que el freno sólo tiene que cortar el ruido: el 429 es para
 * quien manda una clave mala y ya pasó el cupo.
 */
export function decidirAcceso(claveOk: boolean, ipBloqueada: boolean): Acceso {
  if (claveOk) return 'permitir';
  return ipBloqueada ? 'frenar' : 'rechazar';
}

/**
 * Freno de intentos fallidos por IP.
 *
 * Es memoria del proceso y sin limpieza propia más allá de descartar lo viejo
 * cada vez que se consulta: para un solo usuario alcanza. Ojo con que detrás de
 * un túnel o un proxy `req.ip` es siempre el de ese intermediario, así que el
 * contador pasa a ser global y no por cliente. Se acepta en la etapa de prueba;
 * hay que revisarlo antes de cualquier deploy.
 */
export class LimitadorDeFallos {
  private readonly fallos = new Map<string, number[]>();

  constructor(
    private readonly maxFallos = 10,
    private readonly ventanaMs = 60_000,
  ) {}

  bloqueado(ip: string, ahora: number): boolean {
    return this.recientes(ip, ahora).length >= this.maxFallos;
  }

  registrarFallo(ip: string, ahora: number): void {
    this.fallos.set(ip, [...this.recientes(ip, ahora), ahora]);
  }

  private recientes(ip: string, ahora: number): number[] {
    const vigentes = (this.fallos.get(ip) ?? []).filter((t) => ahora - t <= this.ventanaMs);
    if (vigentes.length === 0) this.fallos.delete(ip);
    return vigentes;
  }
}
