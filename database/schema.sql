-- =============================================================================
-- murieron-en-madrid — esquema de la base
-- =============================================================================
--
-- Este archivo NO declara CREATE DATABASE ni USE: la base destino la elige
-- infra/init/01-bootstrap.sh. Asi el mismo DDL se puede cargar en cualquier
-- base sin editarlo.
--
-- Convenciones del modelo (heredadas del backend de referencia):
--   Tablas   PascalCase plural       Players, Tournaments
--   Columnas camelCase               playerId, createdAt
--   Indices  <Tabla>_<columna>_unique / <Tabla>_<columna>_index
--   Estados  CHAR(1) con CHECK       ver notas ENUM del diagrama relacional
--
-- La PK no se puede nombrar: InnoDB llama PRIMARY a toda clave primaria. El
-- nombre del diagrama queda como comentario al lado de cada una.
--
-- Sobre los tipos:
--   BIT del diagrama  -> BOOLEAN (TINYINT(1)), tal como pide la nota del DER.
--   FLOAT del diagrama -> DOUBLE. El sistema original calculaba los puntos con
--     numeros de JavaScript (doble precision); DOUBLE reproduce esa aritmetica
--     exactamente, mientras que FLOAT (precision simple) introduciria ruido en
--     puntajes como 0.25 al acumularlos.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Teams — catalogo fijo de equipos. No es editable por la aplicacion.
-- -----------------------------------------------------------------------------
-- Una fila por letra de la enum. Sagrado y Resto del Mundo son los equipos del
-- derby; Dark y Light son los de un partido normal. La marca isDerbyTeam es lo
-- que permite validar en la BD que un derby no mezcle equipos de las dos clases.
CREATE TABLE Teams (
  team        CHAR(1) NOT NULL,
  isDerbyTeam BOOLEAN NOT NULL,

  PRIMARY KEY (team),                                     -- Teams_primary_key

  CONSTRAINT Teams_team_check CHECK (team IN ('D', 'L', 'S', 'R'))
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

INSERT INTO Teams (team, isDerbyTeam) VALUES
  ('D', FALSE),   -- Dark
  ('L', FALSE),   -- Light
  ('S', TRUE),    -- Sagrado
  ('R', TRUE);    -- Resto del Mundo

-- -----------------------------------------------------------------------------
-- Players — jugadores del grupo
-- -----------------------------------------------------------------------------
-- Un jugador nace activo. Inactivo = no se lo puede convocar a un partido, pero
-- su historial sigue contando en las tablas.
CREATE TABLE Players (
  playerId   INT          NOT NULL AUTO_INCREMENT,
  firstName  VARCHAR(20)  NOT NULL,
  secondName VARCHAR(20)  NOT NULL,
  nickname   VARCHAR(20)  NULL,
  photo      VARCHAR(255) NULL,
  state      CHAR(1)      NOT NULL DEFAULT 'A',
  isSagrado  BOOLEAN      NOT NULL DEFAULT FALSE,
  createdAt  DATETIME     NOT NULL DEFAULT NOW(),

  PRIMARY KEY (playerId),                                 -- Players_primary_key
  KEY Players_state_index (state),

  CONSTRAINT Players_state_check CHECK (state IN ('A', 'I'))
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

-- -----------------------------------------------------------------------------
-- Tournaments — cada temporada con su propia tabla de puntuacion
-- -----------------------------------------------------------------------------
-- El puntaje es propio de cada torneo: la Clausura 2025 pago 0.25 por perder y
-- la Apertura 2025 pagaba 1. Por eso las tres columnas de puntos viven aca y no
-- en una constante de la aplicacion.
--
-- wasTracked = FALSE marca los torneos de los que solo sobrevivio la tabla
-- final (el Excel de 2024). Sus partidos existen para reproducir esa tabla pero
-- el frontend no los muestra, y sus diferencias de gol no se registraron.
CREATE TABLE Tournaments (
  tournamentId  INT         NOT NULL AUTO_INCREMENT,
  `name`        VARCHAR(40) NOT NULL,
  startedAt     DATETIME    NOT NULL,
  endedAt       DATETIME    NOT NULL,
  state         CHAR(1)     NOT NULL DEFAULT 'P',
  wasTracked    BOOLEAN     NOT NULL DEFAULT TRUE,
  winningPoints DOUBLE      NOT NULL,
  lossingPoints DOUBLE      NOT NULL,
  drawingPoints DOUBLE      NOT NULL,
  createdAt     DATETIME    NOT NULL DEFAULT NOW(),

  PRIMARY KEY (tournamentId),                             -- Tournaments_primary_key
  UNIQUE KEY Tournaments_name_unique (`name`),
  KEY Tournaments_startedAt_index (startedAt),

  CONSTRAINT Tournaments_state_check  CHECK (state IN ('P', 'F')),
  CONSTRAINT Tournaments_dates_check  CHECK (endedAt >= startedAt),
  CONSTRAINT Tournaments_points_check CHECK (
    winningPoints >= 0 AND lossingPoints >= 0 AND drawingPoints >= 0
  )
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

-- -----------------------------------------------------------------------------
-- Matches — un partido de un torneo
-- -----------------------------------------------------------------------------
-- winnerTeam NULL significa empate. goalsDiference es el margen SIN signo: de
-- que lado cae lo dice winnerTeam. La vista vMatchPlayerResults es la que le
-- pone signo para cada jugador.
--
-- La UNIQUE (matchId, tournamentId) parece redundante —matchId ya es PK— pero
-- es la que habilita la FK compuesta de MatchPlayers, y con ella la BD garantiza
-- que la convocatoria de un partido no pueda apuntar a otro torneo que el suyo.
CREATE TABLE Matches (
  matchId        INT         NOT NULL AUTO_INCREMENT,
  tournamentId   INT         NOT NULL,
  winnerTeam     CHAR(1)     NULL,
  goalsDiference INT         NOT NULL DEFAULT 0,
  place          VARCHAR(40) NOT NULL,
  playedAt       DATETIME    NOT NULL,
  isDerby        BOOLEAN     NOT NULL DEFAULT FALSE,

  PRIMARY KEY (matchId),                                  -- Matches_primary_key
  UNIQUE KEY Matches_matchId_tournamentId_unique (matchId, tournamentId),
  KEY Matches_tournamentId_index (tournamentId),
  KEY Matches_playedAt_index (playedAt),
  KEY Matches_winnerTeam_index (winnerTeam),

  CONSTRAINT Matches_tournamentId_fk FOREIGN KEY (tournamentId) REFERENCES Tournaments (tournamentId),
  CONSTRAINT Matches_winnerTeam_fk   FOREIGN KEY (winnerTeam)   REFERENCES Teams (team),

  CONSTRAINT Matches_goalsDiference_check CHECK (goalsDiference >= 0),
  -- Un empate no puede tener diferencia de gol. El caso inverso (ganador con
  -- diferencia 0) solo se admite en torneos wasTracked = FALSE y lo valida el
  -- SP, porque un CHECK no puede consultar otra tabla.
  CONSTRAINT Matches_draw_check CHECK (winnerTeam IS NOT NULL OR goalsDiference = 0)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

-- -----------------------------------------------------------------------------
-- MatchPlayers — la convocatoria: que jugador jugo en que equipo
-- -----------------------------------------------------------------------------
-- tournamentId esta desnormalizado a proposito: viene del diagrama y permite
-- filtrar por torneo sin tocar Matches, ademas de cerrar la FK compuesta.
--
-- ON DELETE CASCADE hacia Matches: borrar un partido se lleva su convocatoria.
-- Hacia Players NO hay cascade (RESTRICT por defecto): es justamente lo que
-- impide borrar un jugador con historial.
CREATE TABLE MatchPlayers (
  playerId     INT     NOT NULL,
  matchId      INT     NOT NULL,
  tournamentId INT     NOT NULL,
  team         CHAR(1) NOT NULL,

  PRIMARY KEY (playerId, matchId, tournamentId),          -- MatchPlayers_primary_key
  KEY MatchPlayers_matchId_tournamentId_index (matchId, tournamentId),
  KEY MatchPlayers_tournamentId_team_index (tournamentId, team),
  KEY MatchPlayers_team_index (team),

  CONSTRAINT MatchPlayers_playerId_fk FOREIGN KEY (playerId) REFERENCES Players (playerId),
  CONSTRAINT MatchPlayers_match_fk    FOREIGN KEY (matchId, tournamentId)
    REFERENCES Matches (matchId, tournamentId) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT MatchPlayers_team_fk     FOREIGN KEY (team) REFERENCES Teams (team)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

-- -----------------------------------------------------------------------------
-- PlayerPenalties — puntos que se le restan a un jugador en un torneo
-- -----------------------------------------------------------------------------
-- Una sola fila por (jugador, torneo): la penalizacion es acumulada, no un
-- historial de sanciones. Se resta de los puntos en la tabla de posiciones.
CREATE TABLE PlayerPenalties (
  playerId     INT    NOT NULL,
  tournamentId INT    NOT NULL,
  penalty      DOUBLE NOT NULL,

  PRIMARY KEY (playerId, tournamentId),                   -- PlayerPenalties_primary_key
  KEY PlayerPenalties_tournamentId_index (tournamentId),

  CONSTRAINT PlayerPenalties_playerId_fk     FOREIGN KEY (playerId)     REFERENCES Players (playerId),
  CONSTRAINT PlayerPenalties_tournamentId_fk FOREIGN KEY (tournamentId) REFERENCES Tournaments (tournamentId),

  CONSTRAINT PlayerPenalties_penalty_check CHECK (penalty > 0)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

-- -----------------------------------------------------------------------------
-- Achievements — catalogo de logros
-- -----------------------------------------------------------------------------
-- Catalogo fijo, como Teams: la aplicacion no lo edita. Las filas NO viven aca
-- sino en database/achievements.sql, que se puede reaplicar solo cuando se
-- agrega o se corrige un logro sin volver a cargar todo el esquema.
--
-- La PK es el code y no un autoincremental porque las reglas de
-- vPlayerAchievements lo mencionan una por una: 'CAZADOR' se lee, un 7 no.
--
-- Ningun logro se guarda por jugador. El estado se deduce del historial cada
-- vez que se abre la solapa; esta tabla solo aporta los textos y el orden.
CREATE TABLE Achievements (
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
