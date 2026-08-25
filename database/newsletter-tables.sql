-- =============================================================================
-- murieron-en-madrid — tablas de MurieronNews
-- =============================================================================
-- Aparte de schema.sql porque schema.sql NO se puede reaplicar: no tiene
-- IF NOT EXISTS y se muere en el primer CREATE TABLE. Este archivo si es
-- reaplicable, asi que publicar la funcionalidad sobre datos reales es
-- cargarlo y listo.
--
-- No declara USE: la base destino la elige infra/init/01-bootstrap.sh.
-- =============================================================================

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS NewsletterEditions (
  editionId       INT         NOT NULL AUTO_INCREMENT,
  editionNumber   INT         NOT NULL,
  publishedOn     DATE        NOT NULL,
  publishedAt     DATETIME    NOT NULL DEFAULT NOW(),
  lastMatchId     INT         NOT NULL,
  snapshotVersion INT         NOT NULL,
  snapshot        JSON        NULL,
  model           VARCHAR(40) NOT NULL,
  inputTokens     INT         NOT NULL DEFAULT 0,
  outputTokens    INT         NOT NULL DEFAULT 0,

  PRIMARY KEY (editionId),
  UNIQUE KEY NewsletterEditions_publishedOn_unique (publishedOn),
  UNIQUE KEY NewsletterEditions_editionNumber_unique (editionNumber),
  KEY NewsletterEditions_publishedAt_index (publishedAt)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS NewsletterArticles (
  articleId  INT          NOT NULL AUTO_INCREMENT,
  editionId  INT          NOT NULL,
  section    CHAR(1)      NOT NULL,
  headline   VARCHAR(120) NOT NULL,
  standfirst VARCHAR(240) NOT NULL,
  body       TEXT         NOT NULL,
  sortOrder  INT          NOT NULL,
  isEdited   BOOLEAN      NOT NULL DEFAULT FALSE,

  PRIMARY KEY (articleId),
  KEY NewsletterArticles_editionId_index (editionId),

  CONSTRAINT NewsletterArticles_editionId_fk FOREIGN KEY (editionId)
    REFERENCES NewsletterEditions (editionId) ON DELETE CASCADE,
  CONSTRAINT NewsletterArticles_section_check
    CHECK (section IN ('P','T','H','M','V','C','A','B'))
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS NewsletterArticlePlayers (
  articleId INT     NOT NULL,
  playerId  INT     NOT NULL,
  role      CHAR(1) NOT NULL,

  PRIMARY KEY (articleId, playerId),
  KEY NewsletterArticlePlayers_playerId_index (playerId),

  CONSTRAINT NewsletterArticlePlayers_articleId_fk FOREIGN KEY (articleId)
    REFERENCES NewsletterArticles (articleId) ON DELETE CASCADE,
  CONSTRAINT NewsletterArticlePlayers_playerId_fk FOREIGN KEY (playerId)
    REFERENCES Players (playerId) ON DELETE CASCADE,
  CONSTRAINT NewsletterArticlePlayers_role_check CHECK (role IN ('H','V','M'))
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS PlayerLore (
  playerId  INT      NOT NULL,
  notes     TEXT     NOT NULL,
  updatedAt DATETIME NOT NULL DEFAULT NOW() ON UPDATE NOW(),

  PRIMARY KEY (playerId),

  CONSTRAINT PlayerLore_playerId_fk FOREIGN KEY (playerId)
    REFERENCES Players (playerId) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

-- Las notas del administrador sobre un partido: que paso esa tarde adentro de
-- la cancha. Tabla aparte y no una columna en Matches por lo mismo que
-- PlayerLore: este archivo se reaplica entero con IF NOT EXISTS y un
-- ALTER TABLE no, y Matches es del esquema original.
--
-- ON DELETE CASCADE: borrar un partido se lleva sus notas, igual que se lleva
-- su convocatoria.
CREATE TABLE IF NOT EXISTS MatchNotes (
  matchId   INT      NOT NULL,
  notes     TEXT     NOT NULL,
  updatedAt DATETIME NOT NULL DEFAULT NOW() ON UPDATE NOW(),

  PRIMARY KEY (matchId),

  CONSTRAINT MatchNotes_matchId_fk FOREIGN KEY (matchId)
    REFERENCES Matches (matchId) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS NewsletterConfig (
  configId   TINYINT     NOT NULL DEFAULT 1,
  paperName  VARCHAR(60) NOT NULL DEFAULT 'MurieronNews',
  groupLore  TEXT        NULL,
  styleGuide TEXT        NULL,
  isEnabled  BOOLEAN     NOT NULL DEFAULT TRUE,

  PRIMARY KEY (configId),

  CONSTRAINT NewsletterConfig_singleton_check CHECK (configId = 1)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

-- La fila unica. Sin esto el cron no tiene configuracion que leer y el PUT no
-- tiene que actualizar. INSERT IGNORE lo hace reaplicable.
INSERT IGNORE INTO NewsletterConfig (configId) VALUES (1);
