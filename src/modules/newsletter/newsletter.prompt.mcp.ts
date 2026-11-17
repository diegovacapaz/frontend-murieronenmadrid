import {
  construirSystemCon,
  type ConfigDelManual,
  type VarianteDelManual,
} from './newsletter.prompt';

/**
 * La variante del manual para cuando el diario lo escribe un cliente MCP
 * (claude.ai) y no la API.
 *
 * Cambia sólo las tres piezas que hablan de cómo llega el material y cómo se
 * publica; el resto del manual es el de la API. Habla de "el redactor" y de "el
 * editor" y no de un modelo en particular: MCP es un estándar y el cliente puede
 * no ser Claude algún día.
 *
 * Qué comportamiento de claude.ai supone, **medido en la etapa 1**: un
 * resultado grande de herramienta se guarda como archivo y el sandbox de código
 * lo lee. Si eso cambiara, esta variante tendría que volver a partir el
 * material en pedazos.
 */
export const VARIANTE_MCP: VarianteDelManual = {
  datos: `Los datos NO vienen en este mensaje: los pedís con la herramienta
diario_material, con el draftId que te dio diario_iniciar. Tiene tres partes:
historial (todos los partidos), estado (la foto de hoy) y estado_anterior (la foto
de la edición pasada, con la misma forma exacta). Cada respuesta es grande y queda
guardada como un archivo: abrila desde la herramienta de ejecución de código y
trabajá sobre eso. NO la vuelvas a tipear: ya está ahí, y copiarla a mano cuesta
una fortuna y sale mal.

Con desdeMatchId, la parte historial trae sólo los partidos posteriores a ese id.
El puntero de la edición anterior viene como punteroAnterior en lo que devolvió
diario_iniciar: pasándolo, ves sólo lo que pasó desde entonces.

Antes de escribir, mirá partidosNuevos y aviso en lo que devolvió diario_iniciar.
Si partidosNuevos es 0, no hay nada nuevo que contar.`,
  itemHistorial: 'lo que devuelve diario_material con parte historial',
  entregaFinal: `SOBRE LA SECCIÓN BREVES. El diario la dibuja como una lista: un punto por cada
línea del cuerpo. Escribila con tres a cinco ítems, cada uno de una o dos frases
sobre una cosa distinta, separados por una línea en blanco. Nunca un solo párrafo
con todo junto: si lo que tenés es una sola cosa, no es un breve, es una nota de
otra sección o no se escribe.

Cuando tengas todas las notas escritas y verificadas con código, llamás a
diario_publicar UNA vez, con el draftId y todas las notas juntas. Es lo último que
hacés. Si partidosNuevos era 0, avisale al editor antes de publicar y esperá su
respuesta.

Si diario_publicar devuelve un error, leé el motivo y corregí lo que dice. Después
volvé a llamar a diario_publicar con todas las notas: el borrador sigue vivo. Lo
que se publica es lo que el grupo lee a la mañana.`,
};

/** El manual completo para el MCP. Mismo contrato que `construirSystem`. */
export function construirSystemMcp(config: ConfigDelManual, esInaugural: boolean): string {
  return construirSystemCon(config, esInaugural, VARIANTE_MCP);
}
