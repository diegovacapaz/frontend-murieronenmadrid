/** Las ocho secciones del diario. El CHAR(1) es lo que guarda la base. */
export enum ArticleSection {
  PORTADA = 'P',
  TORNEO = 'T',
  HISTORICA = 'H',
  MUNDIALITO = 'M',
  VITRINA = 'V',
  CLASICOS = 'C',
  ANTICIPOS = 'A',
  BREVES = 'B',
}

/** Qué papel juega un jugador en una nota. Decide qué foto la ilustra. */
export enum PlayerRole {
  HEROE = 'H',
  VILLANO = 'V',
  MENCION = 'M',
}
