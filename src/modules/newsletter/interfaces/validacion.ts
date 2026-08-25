import type { ArticleSection, PlayerRole } from '../enums/newsletter.enums';

/** Una nota lista para insertar: secciones y roles ya en el CHAR(1) de la base. */
export interface NotaValidada {
  seccion: ArticleSection;
  titular: string;
  copete: string;
  cuerpo: string;
  jugadores: Array<{ playerId: number; rol: PlayerRole }>;
}

/**
 * El resultado de validar lo que devolvió el modelo.
 *
 * Es una unión discriminada y no un `NotaValidada[] | null` a propósito: cuando
 * la edición se rechaza, el motivo termina en el log de las cinco de la mañana,
 * que es lo único que va a haber para entender por qué el diario no salió.
 */
export type ResultadoValidacion =
  | { ok: true; notas: NotaValidada[] }
  | { ok: false; motivo: string };
