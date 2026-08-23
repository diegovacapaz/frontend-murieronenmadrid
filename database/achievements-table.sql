-- =============================================================================
-- murieron-en-madrid — la tabla Achievements, para una base que ya existe
-- =============================================================================
-- Instalacion nueva: NO hace falta este archivo. El bootstrap carga schema.sql,
-- que ya trae la tabla, y despues achievements.sql con las filas.
--
-- Base que ya tiene datos: schema.sql no se puede reaplicar —no tiene IF NOT
-- EXISTS y se muere en el primer CREATE TABLE— asi que el DDL de la unica tabla
-- nueva de los logros vive tambien aca, para poder crearla sola:
--
--   node scripts/apply-sql.mjs achievements-table.sql   -- la tabla
--   node scripts/apply-sql.mjs achievements.sql         -- las 28 filas
--   node scripts/apply-sql.mjs                          -- vistas y procedures
--
-- El IF NOT EXISTS lo hace idempotente: correrlo dos veces no rompe nada.
--
-- Este DDL es una copia del de schema.sql. Si alguna vez cambia, hay que
-- cambiarlo en los dos lados; por eso el catalogo de logros no se toca casi
-- nunca y las filas viven en un archivo aparte.
-- =============================================================================

CREATE TABLE IF NOT EXISTS Achievements (
  code        VARCHAR(24)  NOT NULL,
  category    CHAR(1)      NOT NULL,
  title       VARCHAR(40)  NOT NULL,
  description VARCHAR(120) NOT NULL,
  -- Marca los dos logros que pueden romperse (Mexicano y Eterno Candidato). El
  -- motor no lo usa —el estado sale de la regla— pero le avisa al frontend que
  -- esa medalla gris puede terminar agrietada.
  isBreakable BOOLEAN      NOT NULL DEFAULT FALSE,
  sortOrder   INT          NOT NULL,

  PRIMARY KEY (code),                                     -- Achievements_primary_key
  UNIQUE KEY Achievements_sortOrder_unique (sortOrder),
  KEY Achievements_category_index (category),

  CONSTRAINT Achievements_category_check CHECK (category IN ('G', 'S', 'M'))
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;
