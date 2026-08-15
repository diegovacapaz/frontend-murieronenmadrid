/**
 * Los cinco destacados del perfil de un jugador. Los calcula el SP con las
 * mismas reglas que tenia el sistema original.
 *
 * VICTIM y NEMESIS son "hijo" y "papa" en la jerga del grupo: se definen por
 * SALDO (victorias menos derrotas) y no por cantidad bruta de victorias —
 * ganarle 8 de 20 no es dominarlo—, y exigen un minimo de cruces para que un
 * 1-0 en un solo partido no consagre a nadie.
 */
export enum StatHighlightKind {
  /** Mejor saldo a favor: al que mas le gana. */
  VICTIM = 'VICTIM',
  /** Peor saldo: el que mas lo hace sufrir. */
  NEMESIS = 'NEMESIS',
  /** El rival mas repetido, gane o pierda. */
  CLASSIC = 'CLASSIC',
  /** Companiero con el que mejor le va. */
  BEST_CHEMISTRY = 'BEST_CHEMISTRY',
  /** Companiero con el que peor le va. */
  WORST_CHEMISTRY = 'WORST_CHEMISTRY',
}
