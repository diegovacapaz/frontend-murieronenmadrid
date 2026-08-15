/**
 * Estado de una entidad dada de alta o de baja. Hoy lo usan los jugadores; se
 * declara en common porque la convencion 'A'/'I' es transversal al sistema y
 * cualquier entidad futura con baja logica deberia hablar el mismo idioma.
 *
 * Los valores son los CHAR(1) que guarda MySQL: el enum de TypeScript y el
 * CHECK de la tabla dicen lo mismo, cada uno en su capa.
 */
export enum EntityState {
  ACTIVE = 'A',
  INACTIVE = 'I',
}

/**
 * Accion sobre el estado de una entidad. Se expone como verbo en la API
 * (`PATCH /players/:id/state { action: 'activate' }`) en vez de dejar que el
 * cliente mande la letra: el verbo es autoexplicativo y la traduccion a estado
 * vive en el service.
 */
export enum StatusAction {
  ACTIVATE = 'activate',
  DEACTIVATE = 'deactivate',
}
