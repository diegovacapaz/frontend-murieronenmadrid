/**
 * El día de hoy en formato `YYYY-MM-DD`, que es como viaja `publishedOn`.
 *
 * Existe como función compartida y no como expresión suelta por una razón muy
 * concreta: la fecha con la que se CHEQUEA que el día esté libre y la fecha con
 * la que después se INSERTA tienen que ser la misma. Si una se calculara en UTC
 * y la otra en hora local, habría una ventana de tres horas por día en la que el
 * chequeo pasa y el INSERT rebota contra el UNIQUE de `publishedOn` —justo el
 * bug que este helper existe para cerrar—, pero recién después de haberse
 * gastado los catorce minutos y los USD 2,50 de la llamada a la API.
 *
 * Se queda en UTC porque es lo que ya venía haciendo el dossier, y la fecha del
 * diario es una etiqueta, no un instante.
 */
export function fechaDeHoy(): string {
  return new Date().toISOString().slice(0, 10);
}
