/**
 * Los cuatro equipos del sistema. Los valores son los CHAR(1) de la tabla Teams,
 * que se siembra con el schema.
 *
 * Dark y Light son los equipos de un partido comun (los "oscuro" y "claro" del
 * sistema original). Sagrado y Resto del Mundo son los del derby: un partido
 * derby se juega solo entre ellos, y uno comun solo entre los otros dos. La
 * marca isDerbyTeam de la tabla es la que hace cumplir esa regla en la base.
 */
export enum Team {
  DARK = 'D',
  LIGHT = 'L',
  SAGRADO = 'S',
  RESTO_DEL_MUNDO = 'R',
}
