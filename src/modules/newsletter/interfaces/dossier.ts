/**
 * El contrato de lo que el modelo recibe para escribir una edición.
 *
 * Está partido en tres por una razón concreta, no por prolijidad: cada parte
 * tiene un destino distinto. `estado` se guarda como snapshot y mañana es el
 * "antes"; `historial` viaja al prompt pero NO se guarda; `contexto` es lo que
 * no es ni una cosa ni la otra.
 */

/** El dossier completo: todo lo que necesita una edición y nada más. */
export interface Dossier {
  /** Lo que se guarda como snapshot y se compara contra el de ayer. */
  estado: DossierEstado;
  /** Dato fuente. Va al prompt pero NO se guarda: no cambia y siempre está. */
  historial: HistorialPartido[];
  /** Contexto que no es ni estado ni fuente. */
  contexto: {
    fecha: string;
    ultimoMatchId: number;
    titularesRecientes: string[];
    loreGrupo: string | null;
    lorePorJugador: Record<number, string>;
  };
}

/**
 * La foto del sistema, tal como la devuelven los procedures.
 *
 * Los `unknown` son deliberados: son las respuestas de los SP sin tocar, y
 * tipar cada columna acá sería duplicar un contrato que ya vive en el SQL y que
 * además solo lee un modelo de lenguaje. Que no tengan forma propia es lo que
 * garantiza que el "antes" y el "después" sean comparables clave por clave.
 */
export interface DossierEstado {
  version: number;
  general: unknown;
  /** `null` cuando no hay ningún torneo en curso; entre temporadas es lo normal. */
  torneoActivo: unknown;
  mundialito: unknown;
  jugadores: Record<
    number,
    {
      displayName: string;
      summary: unknown;
      highlights: unknown;
      streaks: unknown;
      /** Los 30, con su progreso. De acá salen los anticipos. */
      logros: Array<{
        code: string;
        state: string; // 'U' obtenido · 'L' bloqueado · 'B' roto
        progress: number | null;
        target: number | null;
      }>;
    }
  >;
}

/**
 * Un partido del historial.
 *
 * Este sí se tipa, y no por gusto: el orden y la forma de sus campos es lo que
 * le permite al modelo razonar sobre secuencias —quién venía ganando, cuándo se
 * cortó una racha, contra quién— sin tener que ordenar ni cruzar nada él.
 */
export interface HistorialPartido {
  matchId: number;
  tournamentId: number;
  tournamentName: string;
  playedAt: string; // ISO, para que el modelo pueda ordenar y restar
  place: string;
  isDerby: boolean;
  winnerTeam: string | null; // null es empate
  goalsDiference: number; // margen SIN signo; de qué lado cae lo dice winnerTeam
  /** Las formaciones, con el nombre con el que se los conoce en el grupo. */
  equipos: Array<{
    team: string;
    jugadores: Array<{ playerId: number; displayName: string }>;
  }>;
}
