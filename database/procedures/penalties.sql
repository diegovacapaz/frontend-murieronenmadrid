-- =============================================================================
-- murieron-en-madrid — stored procedures del modulo penalties
-- =============================================================================
-- SQLSTATE: 45000 validacion · 45001 no encontrado · 45002 conflicto
--           45003 estado invalido · 45004 prohibido · 45005 no autenticado
-- Codigos del modulo: 464xx (ver sp-error-codes.constants.ts)
--
-- Una penalizacion es UNA fila por (jugador, torneo) con el acumulado, no un
-- historial de sanciones: asi lo modela el diagrama y asi se usaba en el
-- sistema original (un numero que se resta en la tabla).
--
-- Solo se tocan penalizaciones de torneos en juego, por el mismo motivo que los
-- partidos: un torneo cerrado ya consagro campeon.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- SearchPenalties
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS SearchPenalties;

DELIMITER //
CREATE PROCEDURE SearchPenalties(
    pTournamentId INT,
    pPlayerId     INT
)
BEGIN
    SELECT
        playerId, tournamentId, penalty,
        playerName, playerPhoto, tournamentName, tournamentState
    FROM vPlayerPenaltyDetail
    WHERE (pTournamentId IS NULL OR tournamentId = pTournamentId)
      AND (pPlayerId     IS NULL OR playerId     = pPlayerId)
    ORDER BY tournamentId DESC, penalty DESC, playerName;
END //
DELIMITER ;

-- -----------------------------------------------------------------------------
-- GetPenalty
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS GetPenalty;

DELIMITER //
CREATE PROCEDURE GetPenalty(
    pTournamentId INT,
    pPlayerId     INT
)
BEGIN
    IF (pTournamentId IS NULL) OR (pTournamentId < 1)
        OR (pPlayerId IS NULL) OR (pPlayerId < 1) THEN
        SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 46000,
            MESSAGE_TEXT = 'Identificadores invalidos para buscar la penalizacion';
    ELSE
        SELECT
            playerId, tournamentId, penalty,
            playerName, playerPhoto, tournamentName, tournamentState
        FROM vPlayerPenaltyDetail
        WHERE tournamentId = pTournamentId AND playerId = pPlayerId;
    END IF;
END //
DELIMITER ;

-- -----------------------------------------------------------------------------
-- CreatePlayerPenalty
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS CreatePlayerPenalty;

DELIMITER //
CREATE PROCEDURE CreatePlayerPenalty(
    pTournamentId INT,
    pPlayerId     INT,
    pPenalty      DOUBLE
)
BEGIN
    DECLARE vState CHAR(1);

    IF (pTournamentId IS NULL) OR (pTournamentId < 1)
        OR (pPlayerId IS NULL) OR (pPlayerId < 1)
        OR (pPenalty IS NULL) THEN
        SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 46000,
            MESSAGE_TEXT = 'Datos obligatorios faltantes para crear la penalizacion';
    ELSEIF pPenalty <= 0 THEN
        SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 46402,
            MESSAGE_TEXT = 'La penalizacion debe ser mayor a cero';
    ELSE
        SELECT state INTO vState FROM Tournaments WHERE tournamentId = pTournamentId;

        IF vState IS NULL THEN
            SIGNAL SQLSTATE '45001' SET MYSQL_ERRNO = 46200,
                MESSAGE_TEXT = 'El torneo no existe';
        ELSEIF vState <> 'P' THEN
            SIGNAL SQLSTATE '45003' SET MYSQL_ERRNO = 46202,
                MESSAGE_TEXT = 'El torneo esta finalizado: no admite penalizaciones';
        ELSEIF NOT EXISTS (SELECT 1 FROM Players WHERE playerId = pPlayerId) THEN
            SIGNAL SQLSTATE '45001' SET MYSQL_ERRNO = 46100,
                MESSAGE_TEXT = 'El jugador no existe';
        ELSEIF EXISTS (
            SELECT 1 FROM PlayerPenalties
            WHERE tournamentId = pTournamentId AND playerId = pPlayerId
        ) THEN
            SIGNAL SQLSTATE '45002' SET MYSQL_ERRNO = 46401,
                MESSAGE_TEXT = 'El jugador ya tiene una penalizacion en este torneo';
        ELSE
            INSERT INTO PlayerPenalties (playerId, tournamentId, penalty)
            VALUES (pPlayerId, pTournamentId, pPenalty);

            SELECT
                playerId, tournamentId, penalty,
                playerName, playerPhoto, tournamentName, tournamentState
            FROM vPlayerPenaltyDetail
            WHERE tournamentId = pTournamentId AND playerId = pPlayerId;
        END IF;
    END IF;
END //
DELIMITER ;

-- -----------------------------------------------------------------------------
-- UpdatePlayerPenalty
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS UpdatePlayerPenalty;

DELIMITER //
CREATE PROCEDURE UpdatePlayerPenalty(
    pTournamentId INT,
    pPlayerId     INT,
    pPenalty      DOUBLE
)
BEGIN
    DECLARE vState CHAR(1);

    IF (pTournamentId IS NULL) OR (pTournamentId < 1)
        OR (pPlayerId IS NULL) OR (pPlayerId < 1)
        OR (pPenalty IS NULL) THEN
        SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 46000,
            MESSAGE_TEXT = 'Datos invalidos para actualizar la penalizacion';
    ELSEIF pPenalty <= 0 THEN
        SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 46402,
            MESSAGE_TEXT = 'La penalizacion debe ser mayor a cero';
    ELSE
        SELECT state INTO vState FROM Tournaments WHERE tournamentId = pTournamentId;

        IF vState IS NULL THEN
            SIGNAL SQLSTATE '45001' SET MYSQL_ERRNO = 46200,
                MESSAGE_TEXT = 'El torneo no existe';
        ELSEIF vState <> 'P' THEN
            SIGNAL SQLSTATE '45003' SET MYSQL_ERRNO = 46202,
                MESSAGE_TEXT = 'El torneo esta finalizado: no admite cambios de penalizacion';
        ELSEIF NOT EXISTS (
            SELECT 1 FROM PlayerPenalties
            WHERE tournamentId = pTournamentId AND playerId = pPlayerId
        ) THEN
            SIGNAL SQLSTATE '45001' SET MYSQL_ERRNO = 46400,
                MESSAGE_TEXT = 'La penalizacion no existe';
        ELSE
            UPDATE PlayerPenalties
            SET penalty = pPenalty
            WHERE tournamentId = pTournamentId AND playerId = pPlayerId;

            SELECT
                playerId, tournamentId, penalty,
                playerName, playerPhoto, tournamentName, tournamentState
            FROM vPlayerPenaltyDetail
            WHERE tournamentId = pTournamentId AND playerId = pPlayerId;
        END IF;
    END IF;
END //
DELIMITER ;

-- -----------------------------------------------------------------------------
-- DeletePlayerPenalty
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS DeletePlayerPenalty;

DELIMITER //
CREATE PROCEDURE DeletePlayerPenalty(
    pTournamentId INT,
    pPlayerId     INT
)
BEGIN
    DECLARE vState           CHAR(1);
    DECLARE vPenalty         DOUBLE;
    DECLARE vPlayerName      VARCHAR(41);
    DECLARE vPlayerPhoto     VARCHAR(255);
    DECLARE vTournamentName  VARCHAR(40);

    IF (pTournamentId IS NULL) OR (pTournamentId < 1)
        OR (pPlayerId IS NULL) OR (pPlayerId < 1) THEN
        SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 46000,
            MESSAGE_TEXT = 'Identificadores invalidos para borrar la penalizacion';
    ELSE
        SELECT state INTO vState FROM Tournaments WHERE tournamentId = pTournamentId;

        SELECT penalty, playerName, playerPhoto, tournamentName
          INTO vPenalty, vPlayerName, vPlayerPhoto, vTournamentName
        FROM vPlayerPenaltyDetail
        WHERE tournamentId = pTournamentId AND playerId = pPlayerId;

        IF vState IS NULL THEN
            SIGNAL SQLSTATE '45001' SET MYSQL_ERRNO = 46200,
                MESSAGE_TEXT = 'El torneo no existe';
        ELSEIF vPenalty IS NULL THEN
            SIGNAL SQLSTATE '45001' SET MYSQL_ERRNO = 46400,
                MESSAGE_TEXT = 'La penalizacion no existe';
        ELSEIF vState <> 'P' THEN
            SIGNAL SQLSTATE '45003' SET MYSQL_ERRNO = 46202,
                MESSAGE_TEXT = 'El torneo esta finalizado: no admite cambios de penalizacion';
        ELSE
            DELETE FROM PlayerPenalties
            WHERE tournamentId = pTournamentId AND playerId = pPlayerId;

            SELECT
                pPlayerId       AS playerId,
                pTournamentId   AS tournamentId,
                vPenalty        AS penalty,
                vPlayerName     AS playerName,
                vPlayerPhoto    AS playerPhoto,
                vTournamentName AS tournamentName,
                vState          AS tournamentState;
        END IF;
    END IF;
END //
DELIMITER ;
