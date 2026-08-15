/**
 * Estado de un torneo. Los valores son los CHAR(1) que guarda MySQL.
 *
 * Solo un torneo en juego (P) admite partidos y penalizaciones nuevas.
 * Finalizarlo (F) es lo que consagra al campeon: la vista vTournamentChampions
 * solo mira torneos en F.
 */
export enum TournamentState {
  PLAYING = 'P',
  FINISHED = 'F',
}

/**
 * Accion sobre el estado del torneo, expuesta como verbo en la API.
 *
 * `reopen` existe porque un torneo finalizado no se puede editar: si hay que
 * corregir un resultado cargado mal, primero se reabre. Es deliberadamente un
 * acto explicito y no un efecto colateral de editar.
 */
export enum TournamentStateAction {
  FINISH = 'finish',
  REOPEN = 'reopen',
}
