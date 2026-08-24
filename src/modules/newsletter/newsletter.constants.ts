export const NEWSLETTER_REPOSITORY = 'NEWSLETTER_REPOSITORY';

/**
 * Versión de la forma del dossier. Se sube A MANO cuando se le cambia una
 * columna a alguno de los procedures que lo alimentan.
 *
 * Para qué: el snapshot de ayer quedó con la forma vieja. Con el número
 * guardado, el prompt puede avisarle al modelo que las dos fotos no son
 * comparables campo a campo, en vez de dejar que reporte cambios fantasma —
 * "todos perdieron la racha" porque la columna se llama distinto.
 */
export const SNAPSHOT_VERSION = 1;

/** Cuántas ediciones anteriores se le pasan al modelo para que no se repita. */
export const RECENT_HEADLINES = 5;

/**
 * Mínimo de cruces y de partidos juntos para que un rival o un compañero entre
 * en los destacados de `GetPlayerStats`.
 *
 * Son 5 y 5 porque es lo que usa el perfil del jugador —vienen del sistema
 * original— y el diario tiene que decir lo mismo que la pantalla. Si acá
 * pusiéramos otros, "tu verdugo" en el perfil y "tu verdugo" en el diario
 * podrían ser dos personas distintas.
 */
export const MIN_AGAINST = 5;
export const MIN_TOGETHER = 5;
