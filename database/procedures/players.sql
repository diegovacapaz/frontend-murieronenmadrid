-- =============================================================================
-- murieron-en-madrid — stored procedures del modulo players
-- =============================================================================
-- Contrato de errores (src/database/sp-error-codes.constants.ts):
--
--   SIGNAL SQLSTATE '45001'                       -- categoria -> HTTP status
--     SET MYSQL_ERRNO  = 46100,                   -- codigo    -> AppErrorCode
--         MESSAGE_TEXT = 'El jugador no existe';  -- texto     -> solo al log
--
-- El MYSQL_ERRNO es obligatorio: sin el, el backend responde 500. El
-- MESSAGE_TEXT nunca llega al cliente, asi que se escribe legible.
--
-- SQLSTATE: 45000 validacion · 45001 no encontrado · 45002 conflicto
--           45003 estado invalido · 45004 prohibido · 45005 no autenticado
-- =============================================================================

-- -----------------------------------------------------------------------------
-- SearchPlayers — listado con filtros
-- -----------------------------------------------------------------------------
-- El requerimiento pide filtros chicos y concretos: estado y "sagrado". No hay
-- paginacion a proposito — el padron completo son decenas de filas y el
-- frontend arma la tabla de una.
--
-- Cada parametro en NULL significa "no filtrar por esto".
DROP PROCEDURE IF EXISTS SearchPlayers;

DELIMITER //
CREATE PROCEDURE SearchPlayers(
    pState     CHAR(1),
    pIsSagrado BOOLEAN,
    pSearch    VARCHAR(60)
)
BEGIN
    IF (pState IS NOT NULL) AND (pState NOT IN ('A', 'I')) THEN
        SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 46000,
            MESSAGE_TEXT = 'Estado de jugador invalido';
    ELSE
        SELECT
            playerId,
            firstName,
            secondName,
            nickname,
            displayName,
            photo,
            state,
            isSagrado,
            createdAt,
            cups,
            championships
        FROM vPlayerDetail
        WHERE (pState     IS NULL OR state     = pState)
          AND (pIsSagrado IS NULL OR isSagrado = pIsSagrado)
          AND (pSearch    IS NULL OR pSearch = '' OR
               CONCAT_WS(' ', firstName, secondName, COALESCE(nickname, '')) LIKE CONCAT('%', pSearch, '%'))
        ORDER BY COALESCE(nickname, firstName), firstName, secondName;
    END IF;
END //
DELIMITER ;

-- -----------------------------------------------------------------------------
-- GetPlayerById
-- -----------------------------------------------------------------------------
-- No señaliza cuando no existe: el repository usa callSimpleOrNull y el service
-- decide si eso es un 404. Devolver 0 filas es una respuesta valida, no un error.
DROP PROCEDURE IF EXISTS GetPlayerById;

DELIMITER //
CREATE PROCEDURE GetPlayerById(
    pPlayerId INT
)
BEGIN
    IF (pPlayerId IS NULL) OR (pPlayerId < 1) THEN
        SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 46000,
            MESSAGE_TEXT = 'Identificador de jugador invalido';
    ELSE
        SELECT
            playerId,
            firstName,
            secondName,
            nickname,
            displayName,
            photo,
            state,
            isSagrado,
            createdAt,
            cups,
            championships
        FROM vPlayerDetail
        WHERE playerId = pPlayerId;
    END IF;
END //
DELIMITER ;

-- -----------------------------------------------------------------------------
-- CreatePlayer — un jugador nace siempre activo
-- -----------------------------------------------------------------------------
-- pState llega explicito desde el repository (el service fija 'A'), pero se
-- valida igual por si el caller lo manda NULL por error.
DROP PROCEDURE IF EXISTS CreatePlayer;

DELIMITER //
CREATE PROCEDURE CreatePlayer(
    pFirstName  VARCHAR(20),
    pSecondName VARCHAR(20),
    pNickname   VARCHAR(20),
    pPhoto      VARCHAR(255),
    pIsSagrado  BOOLEAN,
    pState      CHAR(1)
)
BEGIN
    DECLARE vPlayerId INT;

    IF (pFirstName IS NULL) OR (pFirstName = '')
        OR (pSecondName IS NULL) OR (pSecondName = '')
        OR (pIsSagrado IS NULL)
        OR (pState IS NULL) OR (pState NOT IN ('A', 'I')) THEN
        SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 46000,
            MESSAGE_TEXT = 'Datos obligatorios faltantes para crear el jugador';
    ELSE
        INSERT INTO Players (firstName, secondName, nickname, photo, isSagrado, state)
        VALUES (pFirstName, pSecondName, NULLIF(pNickname, ''), NULLIF(pPhoto, ''), pIsSagrado, pState);

        SET vPlayerId = LAST_INSERT_ID();

        SELECT
            playerId, firstName, secondName, nickname, displayName, photo,
            state, isSagrado, createdAt, cups, championships
        FROM vPlayerDetail
        WHERE playerId = vPlayerId;
    END IF;
END //
DELIMITER ;

-- -----------------------------------------------------------------------------
-- UpdatePlayer — recibe la fila completa ya mergeada por el service
-- -----------------------------------------------------------------------------
-- El service trae la entidad, le aplica el DTO parcial encima y manda el
-- resultado entero. El SP no adivina que campos cambiaron.
DROP PROCEDURE IF EXISTS UpdatePlayer;

DELIMITER //
CREATE PROCEDURE UpdatePlayer(
    pPlayerId   INT,
    pFirstName  VARCHAR(20),
    pSecondName VARCHAR(20),
    pNickname   VARCHAR(20),
    pPhoto      VARCHAR(255),
    pIsSagrado  BOOLEAN,
    pState      CHAR(1)
)
BEGIN
    IF (pPlayerId IS NULL) OR (pPlayerId < 1)
        OR (pFirstName IS NULL) OR (pFirstName = '')
        OR (pSecondName IS NULL) OR (pSecondName = '')
        OR (pIsSagrado IS NULL)
        OR (pState IS NULL) OR (pState NOT IN ('A', 'I')) THEN
        SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 46000,
            MESSAGE_TEXT = 'Datos invalidos para actualizar el jugador';
    ELSEIF NOT EXISTS (SELECT 1 FROM Players WHERE playerId = pPlayerId) THEN
        SIGNAL SQLSTATE '45001' SET MYSQL_ERRNO = 46100,
            MESSAGE_TEXT = 'El jugador no existe';
    ELSE
        UPDATE Players
        SET firstName  = pFirstName,
            secondName = pSecondName,
            nickname   = NULLIF(pNickname, ''),
            photo      = NULLIF(pPhoto, ''),
            isSagrado  = pIsSagrado,
            state      = pState
        WHERE playerId = pPlayerId;

        SELECT
            playerId, firstName, secondName, nickname, displayName, photo,
            state, isSagrado, createdAt, cups, championships
        FROM vPlayerDetail
        WHERE playerId = pPlayerId;
    END IF;
END //
DELIMITER ;

-- -----------------------------------------------------------------------------
-- DeletePlayer — solo si esta inactivo y no dejo rastro
-- -----------------------------------------------------------------------------
-- Tres candados, en orden de especificidad:
--   1. tiene que estar inactivo (dar de baja es un acto deliberado previo);
--   2. no puede tener partidos jugados;
--   3. no puede tener penalizaciones cargadas.
-- Borrarlo con historial dejaria partidos apuntando a un jugador inexistente:
-- la FK lo impediria igual, pero con un 1451 crudo que no dice cual es la regla.
--
-- Devuelve la fila borrada: el frontend necesita saber a quien saco de la lista.
DROP PROCEDURE IF EXISTS DeletePlayer;

DELIMITER //
CREATE PROCEDURE DeletePlayer(
    pPlayerId INT
)
BEGIN
    DECLARE vState      CHAR(1);
    DECLARE vFirstName  VARCHAR(20);
    DECLARE vSecondName VARCHAR(20);
    DECLARE vNickname   VARCHAR(20);
    DECLARE vPhoto      VARCHAR(255);
    DECLARE vIsSagrado  BOOLEAN;
    DECLARE vCreatedAt  DATETIME;

    IF (pPlayerId IS NULL) OR (pPlayerId < 1) THEN
        SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 46000,
            MESSAGE_TEXT = 'Identificador de jugador invalido';
    ELSE
        SELECT state, firstName, secondName, nickname, photo, isSagrado, createdAt
          INTO vState, vFirstName, vSecondName, vNickname, vPhoto, vIsSagrado, vCreatedAt
        FROM Players
        WHERE playerId = pPlayerId;

        IF vState IS NULL THEN
            SIGNAL SQLSTATE '45001' SET MYSQL_ERRNO = 46100,
                MESSAGE_TEXT = 'El jugador no existe';
        ELSEIF vState <> 'I' THEN
            SIGNAL SQLSTATE '45003' SET MYSQL_ERRNO = 46102,
                MESSAGE_TEXT = 'Solo se puede borrar un jugador inactivo';
        ELSEIF EXISTS (SELECT 1 FROM MatchPlayers WHERE playerId = pPlayerId) THEN
            SIGNAL SQLSTATE '45002' SET MYSQL_ERRNO = 46103,
                MESSAGE_TEXT = 'El jugador tiene partidos jugados';
        ELSEIF EXISTS (SELECT 1 FROM PlayerPenalties WHERE playerId = pPlayerId) THEN
            SIGNAL SQLSTATE '45002' SET MYSQL_ERRNO = 46103,
                MESSAGE_TEXT = 'El jugador tiene penalizaciones cargadas';
        ELSE
            DELETE FROM Players WHERE playerId = pPlayerId;

            -- La fila borrada se devuelve desde variables, capturadas arriba.
            -- cups y championships son constantes: un jugador sin partidos no
            -- puede haber salido campeon de nada.
            SELECT
                pPlayerId    AS playerId,
                vFirstName   AS firstName,
                vSecondName  AS secondName,
                vNickname    AS nickname,
                COALESCE(NULLIF(vNickname, ''), CONCAT(vFirstName, ' ', vSecondName))
                             AS displayName,
                vPhoto       AS photo,
                vState       AS state,
                vIsSagrado   AS isSagrado,
                vCreatedAt   AS createdAt,
                0            AS cups,
                JSON_ARRAY() AS championships;
        END IF;
    END IF;
END //
DELIMITER ;

-- -----------------------------------------------------------------------------
-- GetPlayerLore — las notas personales que alimentan al diario
-- -----------------------------------------------------------------------------
-- Devuelve siempre una fila: cadena vacia si el jugador no tiene notas. Asi el
-- formulario de admin no tiene que distinguir "no existe" de "esta vacio", que
-- para el es lo mismo.
--
-- Señaliza 404 si el jugador no existe, porque pedir el lore de alguien que no
-- esta es un error del cliente, no un lore vacio.
DROP PROCEDURE IF EXISTS GetPlayerLore;

DELIMITER //
CREATE PROCEDURE GetPlayerLore(
    pPlayerId INT
)
BEGIN
    IF NOT EXISTS (SELECT 1 FROM Players WHERE playerId = pPlayerId) THEN
        SIGNAL SQLSTATE '45001' SET MYSQL_ERRNO = 46100,
            MESSAGE_TEXT = 'El jugador no existe';
    ELSE
        SELECT COALESCE(
            (SELECT notes FROM PlayerLore WHERE playerId = pPlayerId), ''
        ) AS notes;
    END IF;
END //
DELIMITER ;

-- -----------------------------------------------------------------------------
-- UpsertPlayerLore — guarda o borra las notas
-- -----------------------------------------------------------------------------
-- Notas vacias BORRAN la fila en vez de guardar una cadena vacia. Con eso
-- "tiene lore" es una sola pregunta —existe la fila o no— y el dossier no
-- necesita filtrar cadenas vacias antes de armar el prompt.
DROP PROCEDURE IF EXISTS UpsertPlayerLore;

DELIMITER //
CREATE PROCEDURE UpsertPlayerLore(
    pPlayerId INT,
    pNotes    TEXT
)
BEGIN
    IF NOT EXISTS (SELECT 1 FROM Players WHERE playerId = pPlayerId) THEN
        SIGNAL SQLSTATE '45001' SET MYSQL_ERRNO = 46100,
            MESSAGE_TEXT = 'El jugador no existe';
    ELSEIF (pNotes IS NULL) OR (TRIM(pNotes) = '') THEN
        DELETE FROM PlayerLore WHERE playerId = pPlayerId;
    ELSE
        INSERT INTO PlayerLore (playerId, notes) VALUES (pPlayerId, TRIM(pNotes))
        ON DUPLICATE KEY UPDATE notes = VALUES(notes);
    END IF;
END //
DELIMITER ;
