-- =============================================================================
-- murieron-en-madrid — stored procedures del modulo tournaments
-- =============================================================================
-- SQLSTATE: 45000 validacion · 45001 no encontrado · 45002 conflicto
--           45003 estado invalido · 45004 prohibido · 45005 no autenticado
-- Codigos del modulo: 462xx (ver sp-error-codes.constants.ts)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- SearchTournaments
-- -----------------------------------------------------------------------------
-- Orden descendente por fecha de inicio: el torneo vigente primero, que es lo
-- que el frontend abre por defecto.
DROP PROCEDURE IF EXISTS SearchTournaments;

DELIMITER //
CREATE PROCEDURE SearchTournaments(
    pState      CHAR(1),
    pWasTracked BOOLEAN
)
BEGIN
    IF (pState IS NOT NULL) AND (pState NOT IN ('P', 'F')) THEN
        SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 46000,
            MESSAGE_TEXT = 'Estado de torneo invalido';
    ELSE
        SELECT
            tournamentId, `name`, startedAt, endedAt, state, wasTracked,
            winningPoints, lossingPoints, drawingPoints, createdAt,
            matchesCount, derbiesCount, playersCount, penaltiesCount,
            championPlayerId, championName
        FROM vTournamentDetail
        WHERE (pState      IS NULL OR state      = pState)
          AND (pWasTracked IS NULL OR wasTracked = pWasTracked)
        ORDER BY startedAt DESC, tournamentId DESC;
    END IF;
END //
DELIMITER ;

-- -----------------------------------------------------------------------------
-- GetTournamentById
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS GetTournamentById;

DELIMITER //
CREATE PROCEDURE GetTournamentById(
    pTournamentId INT
)
BEGIN
    IF (pTournamentId IS NULL) OR (pTournamentId < 1) THEN
        SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 46000,
            MESSAGE_TEXT = 'Identificador de torneo invalido';
    ELSE
        SELECT
            tournamentId, `name`, startedAt, endedAt, state, wasTracked,
            winningPoints, lossingPoints, drawingPoints, createdAt,
            matchesCount, derbiesCount, playersCount, penaltiesCount,
            championPlayerId, championName
        FROM vTournamentDetail
        WHERE tournamentId = pTournamentId;
    END IF;
END //
DELIMITER ;

-- -----------------------------------------------------------------------------
-- CreateTournament
-- -----------------------------------------------------------------------------
-- El nombre duplicado se valida con un SELECT previo en vez de confiar solo en
-- el UNIQUE KEY, para devolver el codigo documentado (46204) en lugar del 1062
-- nativo de MySQL, que el backend traduciria a un DUPLICATE_ENTRY generico.
DROP PROCEDURE IF EXISTS CreateTournament;

DELIMITER //
CREATE PROCEDURE CreateTournament(
    pName          VARCHAR(40),
    pStartedAt     DATETIME,
    pEndedAt       DATETIME,
    pState         CHAR(1),
    pWasTracked    BOOLEAN,
    pWinningPoints DOUBLE,
    pDrawingPoints DOUBLE,
    pLossingPoints DOUBLE
)
BEGIN
    DECLARE vTournamentId INT;

    IF (pName IS NULL) OR (pName = '')
        OR (pStartedAt IS NULL) OR (pEndedAt IS NULL)
        OR (pState IS NULL) OR (pState NOT IN ('P', 'F'))
        OR (pWasTracked IS NULL)
        OR (pWinningPoints IS NULL) OR (pWinningPoints < 0)
        OR (pDrawingPoints IS NULL) OR (pDrawingPoints < 0)
        OR (pLossingPoints IS NULL) OR (pLossingPoints < 0) THEN
        SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 46000,
            MESSAGE_TEXT = 'Datos obligatorios faltantes para crear el torneo';
    ELSEIF pEndedAt < pStartedAt THEN
        SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 46205,
            MESSAGE_TEXT = 'La fecha de fin es anterior a la de inicio';
    ELSEIF EXISTS (SELECT 1 FROM Tournaments WHERE `name` = pName) THEN
        SIGNAL SQLSTATE '45002' SET MYSQL_ERRNO = 46204,
            MESSAGE_TEXT = 'Ya existe un torneo con ese nombre';
    ELSE
        INSERT INTO Tournaments
            (`name`, startedAt, endedAt, state, wasTracked,
             winningPoints, drawingPoints, lossingPoints)
        VALUES
            (pName, pStartedAt, pEndedAt, pState, pWasTracked,
             pWinningPoints, pDrawingPoints, pLossingPoints);

        SET vTournamentId = LAST_INSERT_ID();

        SELECT
            tournamentId, `name`, startedAt, endedAt, state, wasTracked,
            winningPoints, lossingPoints, drawingPoints, createdAt,
            matchesCount, derbiesCount, playersCount, penaltiesCount,
            championPlayerId, championName
        FROM vTournamentDetail
        WHERE tournamentId = vTournamentId;
    END IF;
END //
DELIMITER ;

-- -----------------------------------------------------------------------------
-- UpdateTournament — solo mientras se juega
-- -----------------------------------------------------------------------------
-- Un torneo finalizado es historia: cambiarle la puntuacion reescribiria tablas
-- ya publicadas y podria mover al campeon. Para corregir algo hay que reabrirlo
-- primero con SetTournamentState, que es un acto explicito.
--
-- wasTracked no se puede cambiar si ya tiene partidos: la marca define como se
-- interpretan (con o sin diferencia de gol real) y darla vuelta a mitad de
-- camino dejaria datos que ya no significan lo que decian.
DROP PROCEDURE IF EXISTS UpdateTournament;

DELIMITER //
CREATE PROCEDURE UpdateTournament(
    pTournamentId  INT,
    pName          VARCHAR(40),
    pStartedAt     DATETIME,
    pEndedAt       DATETIME,
    pWasTracked    BOOLEAN,
    pWinningPoints DOUBLE,
    pDrawingPoints DOUBLE,
    pLossingPoints DOUBLE
)
BEGIN
    DECLARE vState      CHAR(1);
    DECLARE vWasTracked BOOLEAN;

    IF (pTournamentId IS NULL) OR (pTournamentId < 1)
        OR (pName IS NULL) OR (pName = '')
        OR (pStartedAt IS NULL) OR (pEndedAt IS NULL)
        OR (pWasTracked IS NULL)
        OR (pWinningPoints IS NULL) OR (pWinningPoints < 0)
        OR (pDrawingPoints IS NULL) OR (pDrawingPoints < 0)
        OR (pLossingPoints IS NULL) OR (pLossingPoints < 0) THEN
        SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 46000,
            MESSAGE_TEXT = 'Datos invalidos para actualizar el torneo';
    ELSE
        SELECT state, wasTracked INTO vState, vWasTracked
        FROM Tournaments WHERE tournamentId = pTournamentId;

        IF vState IS NULL THEN
            SIGNAL SQLSTATE '45001' SET MYSQL_ERRNO = 46200,
                MESSAGE_TEXT = 'El torneo no existe';
        ELSEIF vState <> 'P' THEN
            SIGNAL SQLSTATE '45003' SET MYSQL_ERRNO = 46202,
                MESSAGE_TEXT = 'El torneo esta finalizado';
        ELSEIF pEndedAt < pStartedAt THEN
            SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 46205,
                MESSAGE_TEXT = 'La fecha de fin es anterior a la de inicio';
        ELSEIF EXISTS (
            SELECT 1 FROM Tournaments
            WHERE `name` = pName AND tournamentId <> pTournamentId
        ) THEN
            SIGNAL SQLSTATE '45002' SET MYSQL_ERRNO = 46204,
                MESSAGE_TEXT = 'Ya existe otro torneo con ese nombre';
        ELSEIF (pWasTracked <> vWasTracked)
            AND EXISTS (SELECT 1 FROM Matches WHERE tournamentId = pTournamentId) THEN
            SIGNAL SQLSTATE '45003' SET MYSQL_ERRNO = 46206,
                MESSAGE_TEXT = 'No se puede cambiar wasTracked con partidos cargados';
        ELSE
            UPDATE Tournaments
            SET `name`        = pName,
                startedAt     = pStartedAt,
                endedAt       = pEndedAt,
                wasTracked    = pWasTracked,
                winningPoints = pWinningPoints,
                drawingPoints = pDrawingPoints,
                lossingPoints = pLossingPoints
            WHERE tournamentId = pTournamentId;

            SELECT
                tournamentId, `name`, startedAt, endedAt, state, wasTracked,
                winningPoints, lossingPoints, drawingPoints, createdAt,
                matchesCount, derbiesCount, playersCount, penaltiesCount,
                championPlayerId, championName
            FROM vTournamentDetail
            WHERE tournamentId = pTournamentId;
        END IF;
    END IF;
END //
DELIMITER ;

-- -----------------------------------------------------------------------------
-- SetTournamentState — finalizar o reabrir
-- -----------------------------------------------------------------------------
-- Finalizar es lo que consagra al campeon (vTournamentChampions solo mira
-- torneos en 'F'). Reabrir es la unica forma de volver a tocar sus partidos.
DROP PROCEDURE IF EXISTS SetTournamentState;

DELIMITER //
CREATE PROCEDURE SetTournamentState(
    pTournamentId INT,
    pState        CHAR(1)
)
BEGIN
    DECLARE vState CHAR(1);

    IF (pTournamentId IS NULL) OR (pTournamentId < 1)
        OR (pState IS NULL) OR (pState NOT IN ('P', 'F')) THEN
        SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 46000,
            MESSAGE_TEXT = 'Datos invalidos para cambiar el estado del torneo';
    ELSE
        SELECT state INTO vState FROM Tournaments WHERE tournamentId = pTournamentId;

        IF vState IS NULL THEN
            SIGNAL SQLSTATE '45001' SET MYSQL_ERRNO = 46200,
                MESSAGE_TEXT = 'El torneo no existe';
        ELSEIF vState = pState THEN
            SIGNAL SQLSTATE '45003' SET MYSQL_ERRNO = 46201,
                MESSAGE_TEXT = 'El torneo ya esta en ese estado';
        ELSE
            UPDATE Tournaments SET state = pState WHERE tournamentId = pTournamentId;

            SELECT
                tournamentId, `name`, startedAt, endedAt, state, wasTracked,
                winningPoints, lossingPoints, drawingPoints, createdAt,
                matchesCount, derbiesCount, playersCount, penaltiesCount,
                championPlayerId, championName
            FROM vTournamentDetail
            WHERE tournamentId = pTournamentId;
        END IF;
    END IF;
END //
DELIMITER ;

-- -----------------------------------------------------------------------------
-- DeleteTournament — solo si no tiene partidos ni penalizaciones
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS DeleteTournament;

DELIMITER //
CREATE PROCEDURE DeleteTournament(
    pTournamentId INT
)
BEGIN
    DECLARE vName          VARCHAR(40);
    DECLARE vStartedAt     DATETIME;
    DECLARE vEndedAt       DATETIME;
    DECLARE vState         CHAR(1);
    DECLARE vWasTracked    BOOLEAN;
    DECLARE vWinningPoints DOUBLE;
    DECLARE vLossingPoints DOUBLE;
    DECLARE vDrawingPoints DOUBLE;
    DECLARE vCreatedAt     DATETIME;

    IF (pTournamentId IS NULL) OR (pTournamentId < 1) THEN
        SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 46000,
            MESSAGE_TEXT = 'Identificador de torneo invalido';
    ELSE
        SELECT `name`, startedAt, endedAt, state, wasTracked,
               winningPoints, lossingPoints, drawingPoints, createdAt
          INTO vName, vStartedAt, vEndedAt, vState, vWasTracked,
               vWinningPoints, vLossingPoints, vDrawingPoints, vCreatedAt
        FROM Tournaments
        WHERE tournamentId = pTournamentId;

        IF vName IS NULL THEN
            SIGNAL SQLSTATE '45001' SET MYSQL_ERRNO = 46200,
                MESSAGE_TEXT = 'El torneo no existe';
        ELSEIF EXISTS (SELECT 1 FROM Matches WHERE tournamentId = pTournamentId) THEN
            SIGNAL SQLSTATE '45002' SET MYSQL_ERRNO = 46203,
                MESSAGE_TEXT = 'El torneo tiene partidos cargados';
        ELSEIF EXISTS (SELECT 1 FROM PlayerPenalties WHERE tournamentId = pTournamentId) THEN
            SIGNAL SQLSTATE '45002' SET MYSQL_ERRNO = 46203,
                MESSAGE_TEXT = 'El torneo tiene penalizaciones cargadas';
        ELSE
            DELETE FROM Tournaments WHERE tournamentId = pTournamentId;

            -- Sin partidos ni penalizaciones, todos los contadores son 0 y no
            -- hay campeon posible: la fila se reconstruye desde variables.
            SELECT
                pTournamentId  AS tournamentId,
                vName          AS `name`,
                vStartedAt     AS startedAt,
                vEndedAt       AS endedAt,
                vState         AS state,
                vWasTracked    AS wasTracked,
                vWinningPoints AS winningPoints,
                vLossingPoints AS lossingPoints,
                vDrawingPoints AS drawingPoints,
                vCreatedAt     AS createdAt,
                0              AS matchesCount,
                0              AS derbiesCount,
                0              AS playersCount,
                0              AS penaltiesCount,
                NULL           AS championPlayerId,
                NULL           AS championName;
        END IF;
    END IF;
END //
DELIMITER ;
