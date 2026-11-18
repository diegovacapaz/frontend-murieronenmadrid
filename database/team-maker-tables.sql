-- =============================================================================
-- murieron-en-madrid — randoms y team maker
-- =============================================================================
-- Reaplicable (IF NOT EXISTS), igual que newsletter-tables.sql. Requiere haber
-- corrido antes match-states.alter.sql.
--
-- No declara USE: la base destino la elige quien lo carga.
-- =============================================================================

SET NAMES utf8mb4;

-- -----------------------------------------------------------------------------
-- MatchGuests — los "randoms": juegan pero no son jugadores de la base
-- -----------------------------------------------------------------------------
-- Se guardan siempre, tambien despues de jugado, para que la ficha y el diario
-- puedan nombrarlos. NINGUNA vista de calculo los lee: no suman nada.
CREATE TABLE IF NOT EXISTS MatchGuests (
  guestId      INT         NOT NULL AUTO_INCREMENT,
  matchId      INT         NOT NULL,
  tournamentId INT         NOT NULL,
  `name`       VARCHAR(20) NOT NULL,
  team         CHAR(1)     NULL,

  PRIMARY KEY (guestId),
  UNIQUE KEY MatchGuests_matchId_name_unique (matchId, `name`),

  CONSTRAINT MatchGuests_match_fk FOREIGN KEY (matchId, tournamentId)
    REFERENCES Matches (matchId, tournamentId) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT MatchGuests_team_fk FOREIGN KEY (team) REFERENCES Teams (team)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

-- -----------------------------------------------------------------------------
-- TeamMakers — una eleccion de equipos en vivo sobre un partido
-- -----------------------------------------------------------------------------
--   W = esperando capitanes, K = eligiendo, V = votando color,
--   F = terminado, C = cancelado.
--
-- activeMatchId es una columna generada que vale matchId solo mientras el maker
-- esta activo: el UNIQUE sobre ella garantiza como mucho un maker activo por
-- partido sin impedir que queden historicos terminados o cancelados.
CREATE TABLE IF NOT EXISTS TeamMakers (
  makerId       INT      NOT NULL AUTO_INCREMENT,
  matchId       INT      NOT NULL,
  state         CHAR(1)  NOT NULL DEFAULT 'W',
  captainCode   CHAR(22) NOT NULL,
  firstSeat     TINYINT  NULL,
  firstByDraw   BOOLEAN  NOT NULL DEFAULT FALSE,
  coinWinner    TINYINT  NULL,
  createdAt     DATETIME NOT NULL DEFAULT NOW(),
  finishedAt    DATETIME NULL,
  activeMatchId INT AS (IF(state IN ('W', 'K', 'V'), matchId, NULL)) VIRTUAL,

  PRIMARY KEY (makerId),
  UNIQUE KEY TeamMakers_activeMatchId_unique (activeMatchId),
  KEY TeamMakers_matchId_index (matchId),

  CONSTRAINT TeamMakers_matchId_fk FOREIGN KEY (matchId)
    REFERENCES Matches (matchId) ON DELETE CASCADE,
  CONSTRAINT TeamMakers_state_check CHECK (state IN ('W', 'K', 'V', 'F', 'C')),
  CONSTRAINT TeamMakers_firstSeat_check CHECK (firstSeat IN (0, 1)),
  CONSTRAINT TeamMakers_coinWinner_check CHECK (coinWinner IN (0, 1))
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

-- -----------------------------------------------------------------------------
-- TeamMakerSeats — los dos lugares de capitan
-- -----------------------------------------------------------------------------
-- tokenHash es el sha256 del token que guarda el telefono del capitan: con el
-- vuelve a su lugar al reabrir el link. vote es el color votado al final.
CREATE TABLE IF NOT EXISTS TeamMakerSeats (
  makerId   INT      NOT NULL,
  seat      TINYINT  NOT NULL,
  playerId  INT      NULL,
  tokenHash CHAR(64) NULL,
  vote      CHAR(1)  NULL,

  PRIMARY KEY (makerId, seat),

  CONSTRAINT TeamMakerSeats_makerId_fk FOREIGN KEY (makerId)
    REFERENCES TeamMakers (makerId) ON DELETE CASCADE,
  CONSTRAINT TeamMakerSeats_playerId_fk FOREIGN KEY (playerId) REFERENCES Players (playerId),
  CONSTRAINT TeamMakerSeats_seat_check CHECK (seat IN (0, 1))
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

-- -----------------------------------------------------------------------------
-- TeamMakerPicks — cada eleccion, guardada antes de difundirse
-- -----------------------------------------------------------------------------
-- Es lo que permite retomar el armado si la API se reinicia. Cada eleccion es
-- un jugador real o un random, nunca los dos.
CREATE TABLE IF NOT EXISTS TeamMakerPicks (
  makerId  INT      NOT NULL,
  turn     TINYINT  NOT NULL,
  seat     TINYINT  NOT NULL,
  playerId INT      NULL,
  guestId  INT      NULL,
  pickedAt DATETIME NOT NULL DEFAULT NOW(),

  PRIMARY KEY (makerId, turn),
  UNIQUE KEY TeamMakerPicks_player_unique (makerId, playerId),
  UNIQUE KEY TeamMakerPicks_guest_unique (makerId, guestId),

  CONSTRAINT TeamMakerPicks_makerId_fk FOREIGN KEY (makerId)
    REFERENCES TeamMakers (makerId) ON DELETE CASCADE,
  CONSTRAINT TeamMakerPicks_playerId_fk FOREIGN KEY (playerId) REFERENCES Players (playerId),
  CONSTRAINT TeamMakerPicks_guestId_fk FOREIGN KEY (guestId)
    REFERENCES MatchGuests (guestId) ON DELETE CASCADE,
  CONSTRAINT TeamMakerPicks_seat_check CHECK (seat IN (0, 1)),
  CONSTRAINT TeamMakerPicks_ref_check CHECK ((playerId IS NULL) <> (guestId IS NULL))
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;
