/**
 * Raices de ruta de todos los controllers. Independiente del prefijo global
 * `/api` que se configura en main.ts.
 *
 * Estar todas juntas hace que se vea de un vistazo la superficie de la API, y
 * que ningun controller invente una ruta a mano.
 */
export enum ApiRoute {
  HEALTH = 'health',
  AUTH = 'auth',
  PLAYERS = 'players',
  TOURNAMENTS = 'tournaments',
  MATCHES = 'matches',
  PENALTIES = 'penalties',
  TEAMS = 'teams',
  SCOREBOARD = 'scoreboard',
  STATS = 'stats',
}
