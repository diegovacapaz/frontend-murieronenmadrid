import { randomUUID } from 'node:crypto';

const TRES_HORAS_MS = 3 * 60 * 60 * 1000;

/**
 * Borradores en memoria del proceso: lo que `diario_iniciar` arma y
 * `diario_publicar` consume.
 *
 * Es memoria y no una tabla a propósito: el backend corre en un solo proceso
 * (ya lo asume el candado de generación), así que alcanza, y no hay SQL nuevo
 * que aplicar en el servidor. El precio es que un reinicio entre `iniciar` y
 * `publicar` pierde el borrador: se pierde una conversación, no una edición,
 * porque nada se escribió en la base hasta publicar.
 *
 * Tres reglas, las de la spec:
 *  · un borrador vence a las 3 horas;
 *  · hay a lo sumo 3 vivos, y guardar un cuarto descarta el más viejo;
 *  · uno vencido no cuenta para el tope.
 *
 * El reloj se inyecta para poder probar el vencimiento sin esperar tres horas.
 */
export class AlmacenDeBorradores<T> {
  private readonly borradores = new Map<string, { valor: T; creadoEn: number }>();
  private readonly ttlMs: number;
  private readonly max: number;
  private readonly ahora: () => number;

  constructor(opciones: { ttlMs?: number; max?: number; ahora?: () => number } = {}) {
    this.ttlMs = opciones.ttlMs ?? TRES_HORAS_MS;
    this.max = opciones.max ?? 3;
    this.ahora = opciones.ahora ?? Date.now;
  }

  guardar(valor: T): string {
    this.descartarVencidos();

    // El Map conserva el orden de inserción, y el reloj no retrocede: el primero
    // que sale al iterar es el más viejo.
    while (this.borradores.size >= this.max) {
      const masViejo = this.borradores.keys().next();
      if (masViejo.done) break;
      this.borradores.delete(masViejo.value);
    }

    const id = randomUUID();
    this.borradores.set(id, { valor, creadoEn: this.ahora() });
    return id;
  }

  obtener(id: string): T | null {
    const borrador = this.borradores.get(id);
    if (!borrador) return null;

    if (this.vencido(borrador.creadoEn)) {
      this.borradores.delete(id);
      return null;
    }

    return borrador.valor;
  }

  descartar(id: string): void {
    this.borradores.delete(id);
  }

  private vencido(creadoEn: number): boolean {
    return this.ahora() - creadoEn > this.ttlMs;
  }

  private descartarVencidos(): void {
    for (const [id, borrador] of this.borradores) {
      if (this.vencido(borrador.creadoEn)) this.borradores.delete(id);
    }
  }
}
