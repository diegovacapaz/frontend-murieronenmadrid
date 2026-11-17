-- =============================================================================
-- murieron-en-madrid — tablas del Powerade
-- =============================================================================
-- El ranking de los mejores del torneo que arma la IA y se publica por el MCP.
--
-- Aparte de schema.sql por lo mismo que newsletter-tables.sql: schema.sql NO se
-- puede reaplicar (no tiene IF NOT EXISTS y se muere en el primer CREATE TABLE).
-- Este archivo si es reaplicable, asi que publicar la funcionalidad sobre datos
-- reales es cargarlo y listo:
--
--   node scripts/apply-sql.mjs powerade-tables.sql
--
-- No declara USE: la base destino la elige infra/init/01-bootstrap.sh.
-- Sin tildes en los comentarios: el cliente mysql de la imagen oficial se
-- conecta en latin1 y las tildes entran mal.
-- =============================================================================

SET NAMES utf8mb4;

-- Una fila por VERSION del ranking de un torneo. Cada version que se publica con
-- partidos nuevos es una fila nueva (las flechas de movimiento comparan contra
-- la anterior); publicar sin partidos nuevos reemplaza la ultima en lugar de
-- agregar otra.
--
-- lastMatchId: el MAX(matchId) DEL TORNEO que el redactor tuvo delante. Con el
-- se calcula cuantos partidos se cargaron desde entonces.
--
-- revision: sube en cada reemplazo. Es lo que permite detectar que alguien
-- publico en el medio: el UPDATE del reemplazo se condiciona a la revision con
-- la que se escribio el borrador. Es un contador y no un timestamp porque NOW()
-- tiene precision de segundos y dos reemplazos en el mismo segundo no se
-- distinguirian.
--
-- ON DELETE CASCADE hacia Tournaments: borrar un torneo se lleva sus rankings.
CREATE TABLE IF NOT EXISTS PoweradeRankings (
  rankingId    INT         NOT NULL AUTO_INCREMENT,
  tournamentId INT         NOT NULL,
  version      INT         NOT NULL,
  lastMatchId  INT         NOT NULL,
  revision     INT         NOT NULL DEFAULT 1,
  publishedAt  DATETIME    NOT NULL DEFAULT NOW(),
  model        VARCHAR(40) NOT NULL,

  PRIMARY KEY (rankingId),
  UNIQUE KEY PoweradeRankings_tournament_version_unique (tournamentId, version),
  KEY PoweradeRankings_tournament_ranking_index (tournamentId, rankingId),

  CONSTRAINT PoweradeRankings_tournamentId_fk FOREIGN KEY (tournamentId)
    REFERENCES Tournaments (tournamentId) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

-- Los tres puestos de cada version.
--
-- UNIQUE (rankingId, playerId): un jugador no puede estar dos veces en la misma
-- version.
--
-- ON DELETE CASCADE hacia Players, por el mismo motivo que en las notas del
-- diario: que alguien este en un ranking no puede impedir borrarlo. La
-- consecuencia es que una version puede quedar con dos puestos; la lectura la
-- trata como "sin ranking" hasta que se publique una nueva.
CREATE TABLE IF NOT EXISTS PoweradeEntries (
  rankingId INT          NOT NULL,
  position  TINYINT      NOT NULL,
  playerId  INT          NOT NULL,
  reason    VARCHAR(300) NOT NULL,

  PRIMARY KEY (rankingId, position),
  UNIQUE KEY PoweradeEntries_ranking_player_unique (rankingId, playerId),
  KEY PoweradeEntries_playerId_index (playerId),

  CONSTRAINT PoweradeEntries_rankingId_fk FOREIGN KEY (rankingId)
    REFERENCES PoweradeRankings (rankingId) ON DELETE CASCADE,
  CONSTRAINT PoweradeEntries_playerId_fk FOREIGN KEY (playerId)
    REFERENCES Players (playerId) ON DELETE CASCADE,
  CONSTRAINT PoweradeEntries_position_check CHECK (position BETWEEN 1 AND 3)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;
