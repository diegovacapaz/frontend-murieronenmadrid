/**
 * Fija el proceso en UTC antes de que se cargue nada mas.
 *
 * Tiene que ser el PRIMER import de main.ts: `Date` de Node lee process.env.TZ
 * una sola vez, al inicializarse. Si se setea despues de que algun modulo ya
 * creo una fecha, el cambio no toma efecto y el servidor queda formateando en
 * la zona del host — que en un contenedor puede ser cualquiera.
 *
 * Con esto, el pool de MySQL (que abre cada sesion con time_zone='+00:00') y el
 * runtime hablan el mismo idioma: todo instante viaja en UTC y el frontend lo
 * muestra en la zona del usuario.
 */
process.env.TZ = 'UTC';
