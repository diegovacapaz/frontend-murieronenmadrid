import { defineConfig } from 'vitest/config';

/**
 * Primer runner de tests del proyecto. Cubre solo lógica pura: funciones que
 * reciben datos y devuelven datos.
 *
 * Deliberadamente NO se testea nada que necesite el contenedor de inyección de
 * Nest. Vitest transpila con esbuild, que no emite `emitDecoratorMetadata`, así
 * que los tipos de los parámetros de un constructor no llegan en runtime y la
 * inyección por tipo no funcionaría. Lo que sí funciona es `SetMetadata`, que
 * escribe la metadata a mano — por eso el guard sí se puede testear, con un
 * ExecutionContext armado a mano.
 *
 * Lo que no se puede testear así se verifica con scripts/, que es la convención
 * que ya tiene el proyecto.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
    environment: 'node',
    setupFiles: ['reflect-metadata'],
  },
});
