import type { AppErrorCodeValue } from '../common/constants/error-codes.constants';

/**
 * Contrato de errores entre los stored procedures y el backend.
 *
 * Un SIGNAL de un SP transporta tres cosas, y cada una tiene un rol distinto:
 *
 *   SIGNAL SQLSTATE '45001'                       -- categoria -> HTTP status
 *     SET MYSQL_ERRNO  = 46100,                   -- codigo    -> AppErrorCode
 *         MESSAGE_TEXT = 'El jugador no existe';  -- texto     -> solo para logs
 *
 * El **codigo numerico es el contrato**: el backend le da significado
 * traduciendolo a un `AppErrorCode`, que es lo que el frontend usa como clave
 * de i18n. El MESSAGE_TEXT no viaja al cliente; sirve para que el SQL se lea y
 * para que el log diga algo util.
 *
 * Ventaja sobre transportar el string: el SQL no necesita conocer el
 * vocabulario del frontend, y un numero que no este en este catalogo produce un
 * 500 con log —una falla ruidosa— en vez de una clave de traduccion rota que
 * nadie nota.
 *
 * Rango 46000-46999, agrupado por modulo, distinto del 45xxx de los SQLSTATE
 * para que al leer un SIGNAL no se confundan entre si.
 *
 * El `satisfies` de abajo hace que el compilador rechace cualquier clave que no
 * sea un AppErrorCode existente: un typo no llega a ejecutarse.
 */
export const SpErrorCode = {
  // ── Common (46000-46099) ──
  VALIDATION_FAILED: 46000,

  // ── Players (46100-46199) ──
  PLAYER_NOT_FOUND: 46100,
  PLAYER_ALREADY_IN_STATE: 46101,
  PLAYER_MUST_BE_INACTIVE: 46102,
  PLAYER_HAS_HISTORY: 46103,

  // ── Tournaments (46200-46299) ──
  TOURNAMENT_NOT_FOUND: 46200,
  TOURNAMENT_ALREADY_IN_STATE: 46201,
  TOURNAMENT_NOT_PLAYING: 46202,
  TOURNAMENT_HAS_HISTORY: 46203,
  TOURNAMENT_NAME_ALREADY_EXISTS: 46204,
  TOURNAMENT_INVALID_DATES: 46205,
  TOURNAMENT_TRACKING_LOCKED: 46206,

  // ── Matches (46300-46399) ──
  MATCH_NOT_FOUND: 46300,
  MATCH_INVALID_LINEUP: 46301,
  MATCH_INVALID_TEAMS: 46302,
  MATCH_WINNER_NOT_IN_MATCH: 46303,
  MATCH_INVALID_RESULT: 46304,
  MATCH_DUPLICATED_PLAYER: 46305,
  MATCH_PLAYER_INACTIVE: 46306,

  // ── Penalties (46400-46499) ──
  PENALTY_NOT_FOUND: 46400,
  PENALTY_ALREADY_EXISTS: 46401,
  PENALTY_INVALID_VALUE: 46402,

  // ── Teams (46500-46599) ──
  TEAM_NOT_FOUND: 46500,
} as const satisfies Partial<Record<AppErrorCodeValue, number>>;

export type SpErrorCodeValue = (typeof SpErrorCode)[keyof typeof SpErrorCode];

/**
 * Inverso del catalogo: el numero que emitio el SP -> su AppErrorCode.
 * Se construye una sola vez, al cargar el modulo.
 */
const APP_ERROR_CODE_BY_ERRNO = new Map<number, AppErrorCodeValue>(
  Object.entries(SpErrorCode).map(([name, errno]) => [errno, name as AppErrorCodeValue]),
);

/**
 * Traduce el MYSQL_ERRNO de un SIGNAL a su AppErrorCode.
 * Devuelve `null` si el numero no esta catalogado — el caller decide que hacer,
 * que hoy es responder 500 y loguear el numero huerfano.
 */
export function appErrorCodeFromErrno(errno: number): AppErrorCodeValue | null {
  return APP_ERROR_CODE_BY_ERRNO.get(errno) ?? null;
}
