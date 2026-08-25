-- =============================================================================
-- murieron-en-madrid — stored procedures del modulo matches
-- =============================================================================
-- SQLSTATE: 45000 validacion · 45001 no encontrado · 45002 conflicto
--           45003 estado invalido · 45004 prohibido · 45005 no autenticado
-- Codigos del modulo: 463xx (ver sp-error-codes.constants.ts)
--
-- Estos SPs escriben en dos tablas (Matches + MatchPlayers), asi que corren en
-- transaccion con un EXIT HANDLER que revierte y re-señaliza. Como el handler
-- corta la ejecucion, las validaciones se escriben en secuencia (IF ... SIGNAL)
-- en vez de la cadena ELSEIF del resto de los modulos: son diez controles y
-- anidarlos los volveria ilegibles.
--
-- La convocatoria llega como JSON: [{"playerId": 1, "team": "D"}, ...]. Se
-- desarma con JSON_TABLE a una tabla temporal para no repetir el parseo en cada
-- control.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- SearchMatches
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS SearchMatches;

DELIMITER //
CREATE PROCEDURE SearchMatches(
    pTournamentId INT,
    pIsDerby      BOOLEAN,
    pPlayerId     INT
)
BEGIN
    SELECT
        matchId, tournamentId, tournamentName, winnerTeam, goalsDiference,
        place, playedAt, isDerby, players
    FROM vMatchDetail m
    WHERE (pTournamentId IS NULL OR m.tournamentId = pTournamentId)
      AND (pIsDerby      IS NULL OR m.isDerby      = pIsDerby)
      AND (pPlayerId     IS NULL OR EXISTS (
            SELECT 1 FROM MatchPlayers mp
            WHERE mp.matchId = m.matchId AND mp.playerId = pPlayerId))
    ORDER BY m.playedAt DESC, m.matchId DESC;
END //
DELIMITER ;

-- -----------------------------------------------------------------------------
-- GetMatchById
-- -----------------------------------------------------------------------------
-- NO devuelve las notas del administrador, y es a proposito: este SP alimenta
-- un endpoint publico y las notas son material privado del diario. Se leen por
-- GetMatchNotes, que sale detras de @AdminOnly().
DROP PROCEDURE IF EXISTS GetMatchById;

DELIMITER //
CREATE PROCEDURE GetMatchById(
    pMatchId INT
)
BEGIN
    IF (pMatchId IS NULL) OR (pMatchId < 1) THEN
        SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 46000,
            MESSAGE_TEXT = 'Identificador de partido invalido';
    ELSE
        SELECT
            matchId, tournamentId, tournamentName, winnerTeam, goalsDiference,
            place, playedAt, isDerby, players
        FROM vMatchDetail
        WHERE matchId = pMatchId;
    END IF;
END //
DELIMITER ;

-- -----------------------------------------------------------------------------
-- GetMatchNotes — lo que paso esa tarde adentro de la cancha
-- -----------------------------------------------------------------------------
-- Devuelve siempre una fila: cadena vacia si el partido no tiene notas. Asi el
-- formulario de admin no tiene que distinguir "no existe" de "esta vacio", que
-- para el es lo mismo.
--
-- Señaliza 404 si el partido no existe, porque pedir las notas de un partido
-- que no esta es un error del cliente, no una nota vacia.
DROP PROCEDURE IF EXISTS GetMatchNotes;

DELIMITER //
CREATE PROCEDURE GetMatchNotes(
    pMatchId INT
)
BEGIN
    IF (pMatchId IS NULL) OR (pMatchId < 1) THEN
        SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 46000,
            MESSAGE_TEXT = 'Identificador de partido invalido';
    ELSEIF NOT EXISTS (SELECT 1 FROM Matches WHERE matchId = pMatchId) THEN
        SIGNAL SQLSTATE '45001' SET MYSQL_ERRNO = 46300,
            MESSAGE_TEXT = 'El partido no existe';
    ELSE
        SELECT COALESCE(
            (SELECT notes FROM MatchNotes WHERE matchId = pMatchId), ''
        ) AS notes;
    END IF;
END //
DELIMITER ;

-- -----------------------------------------------------------------------------
-- CreateMatch
-- -----------------------------------------------------------------------------
-- Reglas que se hacen cumplir aca, y el porque de cada una:
--
--  · El torneo tiene que estar en juego. Cargar un partido en un torneo cerrado
--    moveria una tabla ya publicada y potencialmente al campeon.
--  · Un derby se juega SOLO entre equipos derby (Sagrado / Resto del Mundo), y
--    un partido normal solo entre Dark y Light. La marca isDerbyTeam de la
--    tabla Teams es la que decide; no hay listas hardcodeadas.
--  · Empate <=> diferencia 0. La unica excepcion es un torneo wasTracked=FALSE,
--    donde se conoce el ganador pero no el marcador: ahi se admite ganador con
--    diferencia 0, que significa "no registrada".
--  · El ganador tiene que ser uno de los equipos que efectivamente jugaron.
--  · Nadie inactivo entra a una convocatoria, y nadie aparece dos veces.
--
-- Se admite una sola formacion cargada (un equipo): hay partidos historicos
-- donde solo se anoto quienes ganaron. Puntuan los presentes y listo.
DROP PROCEDURE IF EXISTS CreateMatch;

DELIMITER //
CREATE PROCEDURE CreateMatch(
    pTournamentId   INT,
    pWinnerTeam     CHAR(1),
    pGoalsDiference INT,
    pPlace          VARCHAR(40),
    pPlayedAt       DATETIME,
    pIsDerby        BOOLEAN,
    pPlayers        JSON,
    pNotes          TEXT
)
BEGIN
    DECLARE vMatchId    INT;
    DECLARE vState      CHAR(1);
    DECLARE vWasTracked BOOLEAN;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        DROP TEMPORARY TABLE IF EXISTS tmpLineup;
        RESIGNAL;
    END;

    IF (pTournamentId IS NULL) OR (pTournamentId < 1)
        OR (pPlace IS NULL) OR (pPlace = '')
        OR (pPlayedAt IS NULL)
        OR (pIsDerby IS NULL)
        OR (pGoalsDiference IS NULL) OR (pGoalsDiference < 0)
        OR (pPlayers IS NULL) THEN
        SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 46000,
            MESSAGE_TEXT = 'Datos obligatorios faltantes para crear el partido';
    END IF;

    SELECT state, wasTracked INTO vState, vWasTracked
    FROM Tournaments WHERE tournamentId = pTournamentId;

    IF vState IS NULL THEN
        SIGNAL SQLSTATE '45001' SET MYSQL_ERRNO = 46200,
            MESSAGE_TEXT = 'El torneo no existe';
    END IF;

    IF vState <> 'P' THEN
        SIGNAL SQLSTATE '45003' SET MYSQL_ERRNO = 46202,
            MESSAGE_TEXT = 'El torneo esta finalizado: no admite partidos nuevos';
    END IF;

    CALL AssertMatchResult(pWinnerTeam, pGoalsDiference, pIsDerby, vWasTracked);

    DROP TEMPORARY TABLE IF EXISTS tmpLineup;
    CREATE TEMPORARY TABLE tmpLineup (
        playerId INT NULL,
        team     VARCHAR(1) NULL
    ) ENGINE = MEMORY;

    INSERT INTO tmpLineup (playerId, team)
    SELECT jt.playerId, jt.team
    FROM JSON_TABLE(pPlayers, '$[*]' COLUMNS (
        playerId INT        PATH '$.playerId',
        team     VARCHAR(1) PATH '$.team'
    )) AS jt;

    CALL AssertLineup(pWinnerTeam, pIsDerby, NULL);

    START TRANSACTION;

    INSERT INTO Matches (tournamentId, winnerTeam, goalsDiference, place, playedAt, isDerby)
    VALUES (pTournamentId, pWinnerTeam, pGoalsDiference, pPlace, pPlayedAt, pIsDerby);

    SET vMatchId = LAST_INSERT_ID();

    INSERT INTO MatchPlayers (playerId, matchId, tournamentId, team)
    SELECT playerId, vMatchId, pTournamentId, team FROM tmpLineup;

    -- Adentro de la transaccion: si el partido no se crea, las notas tampoco.
    IF (pNotes IS NOT NULL) AND (TRIM(pNotes) <> '') THEN
        INSERT INTO MatchNotes (matchId, notes) VALUES (vMatchId, TRIM(pNotes));
    END IF;

    COMMIT;

    DROP TEMPORARY TABLE IF EXISTS tmpLineup;

    SELECT
        matchId, tournamentId, tournamentName, winnerTeam, goalsDiference,
        place, playedAt, isDerby, players
    FROM vMatchDetail
    WHERE matchId = vMatchId;
END //
DELIMITER ;

-- -----------------------------------------------------------------------------
-- UpdateMatch — reemplaza el partido entero, convocatoria incluida
-- -----------------------------------------------------------------------------
-- No intenta un diff de la formacion: borra la vieja y escribe la nueva dentro
-- de la misma transaccion. Es mas simple de leer y deja el mismo resultado.
--
-- Unica diferencia con el alta: un jugador que ya estaba en este partido se
-- acepta aunque hoy este inactivo. Si no, dar de baja a alguien congelaria para
-- siempre los partidos que jugo, que es exactamente al reves de lo que se
-- quiere (inactivo = no lo convoques mas, no = borra su historia).
DROP PROCEDURE IF EXISTS UpdateMatch;

DELIMITER //
CREATE PROCEDURE UpdateMatch(
    pMatchId        INT,
    pWinnerTeam     CHAR(1),
    pGoalsDiference INT,
    pPlace          VARCHAR(40),
    pPlayedAt       DATETIME,
    pIsDerby        BOOLEAN,
    pPlayers        JSON,
    pNotes          TEXT
)
BEGIN
    DECLARE vTournamentId INT;
    DECLARE vState        CHAR(1);
    DECLARE vWasTracked   BOOLEAN;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        DROP TEMPORARY TABLE IF EXISTS tmpLineup;
        RESIGNAL;
    END;

    IF (pMatchId IS NULL) OR (pMatchId < 1)
        OR (pPlace IS NULL) OR (pPlace = '')
        OR (pPlayedAt IS NULL)
        OR (pIsDerby IS NULL)
        OR (pGoalsDiference IS NULL) OR (pGoalsDiference < 0)
        OR (pPlayers IS NULL) THEN
        SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 46000,
            MESSAGE_TEXT = 'Datos invalidos para actualizar el partido';
    END IF;

    SELECT m.tournamentId, t.state, t.wasTracked
      INTO vTournamentId, vState, vWasTracked
    FROM Matches m
    INNER JOIN Tournaments t ON t.tournamentId = m.tournamentId
    WHERE m.matchId = pMatchId;

    IF vTournamentId IS NULL THEN
        SIGNAL SQLSTATE '45001' SET MYSQL_ERRNO = 46300,
            MESSAGE_TEXT = 'El partido no existe';
    END IF;

    IF vState <> 'P' THEN
        SIGNAL SQLSTATE '45003' SET MYSQL_ERRNO = 46202,
            MESSAGE_TEXT = 'El torneo esta finalizado: sus partidos no se editan';
    END IF;

    CALL AssertMatchResult(pWinnerTeam, pGoalsDiference, pIsDerby, vWasTracked);

    DROP TEMPORARY TABLE IF EXISTS tmpLineup;
    CREATE TEMPORARY TABLE tmpLineup (
        playerId INT NULL,
        team     VARCHAR(1) NULL
    ) ENGINE = MEMORY;

    INSERT INTO tmpLineup (playerId, team)
    SELECT jt.playerId, jt.team
    FROM JSON_TABLE(pPlayers, '$[*]' COLUMNS (
        playerId INT        PATH '$.playerId',
        team     VARCHAR(1) PATH '$.team'
    )) AS jt;

    CALL AssertLineup(pWinnerTeam, pIsDerby, pMatchId);

    START TRANSACTION;

    UPDATE Matches
    SET winnerTeam     = pWinnerTeam,
        goalsDiference = pGoalsDiference,
        place          = pPlace,
        playedAt       = pPlayedAt,
        isDerby        = pIsDerby
    WHERE matchId = pMatchId;

    DELETE FROM MatchPlayers WHERE matchId = pMatchId;

    INSERT INTO MatchPlayers (playerId, matchId, tournamentId, team)
    SELECT playerId, pMatchId, vTournamentId, team FROM tmpLineup;

    -- Notas vacias BORRAN la fila, como en UpsertPlayerLore: asi "tiene notas"
    -- es una sola pregunta y el dossier no filtra cadenas vacias.
    IF (pNotes IS NULL) OR (TRIM(pNotes) = '') THEN
        DELETE FROM MatchNotes WHERE matchId = pMatchId;
    ELSE
        INSERT INTO MatchNotes (matchId, notes) VALUES (pMatchId, TRIM(pNotes))
        ON DUPLICATE KEY UPDATE notes = VALUES(notes);
    END IF;

    COMMIT;

    DROP TEMPORARY TABLE IF EXISTS tmpLineup;

    SELECT
        matchId, tournamentId, tournamentName, winnerTeam, goalsDiference,
        place, playedAt, isDerby, players
    FROM vMatchDetail
    WHERE matchId = pMatchId;
END //
DELIMITER ;

-- -----------------------------------------------------------------------------
-- DeleteMatch — solo de un torneo en juego
-- -----------------------------------------------------------------------------
-- La convocatoria se va sola: MatchPlayers tiene ON DELETE CASCADE hacia
-- Matches. La fila se devuelve capturada antes del borrado.
DROP PROCEDURE IF EXISTS DeleteMatch;

DELIMITER //
CREATE PROCEDURE DeleteMatch(
    pMatchId INT
)
BEGIN
    DECLARE vTournamentId INT;
    DECLARE vState        CHAR(1);

    IF (pMatchId IS NULL) OR (pMatchId < 1) THEN
        SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 46000,
            MESSAGE_TEXT = 'Identificador de partido invalido';
    ELSE
        SELECT m.tournamentId, t.state INTO vTournamentId, vState
        FROM Matches m
        INNER JOIN Tournaments t ON t.tournamentId = m.tournamentId
        WHERE m.matchId = pMatchId;

        IF vTournamentId IS NULL THEN
            SIGNAL SQLSTATE '45001' SET MYSQL_ERRNO = 46300,
                MESSAGE_TEXT = 'El partido no existe';
        ELSEIF vState <> 'P' THEN
            SIGNAL SQLSTATE '45003' SET MYSQL_ERRNO = 46202,
                MESSAGE_TEXT = 'El torneo esta finalizado: sus partidos no se borran';
        ELSE
            DROP TEMPORARY TABLE IF EXISTS tmpDeletedMatch;
            CREATE TEMPORARY TABLE tmpDeletedMatch AS
            SELECT
                matchId, tournamentId, tournamentName, winnerTeam, goalsDiference,
                place, playedAt, isDerby, players
            FROM vMatchDetail
            WHERE matchId = pMatchId;

            DELETE FROM Matches WHERE matchId = pMatchId;

            SELECT * FROM tmpDeletedMatch;
            DROP TEMPORARY TABLE tmpDeletedMatch;
        END IF;
    END IF;
END //
DELIMITER ;

-- =============================================================================
-- Helpers de validacion — compartidos por CreateMatch y UpdateMatch
-- =============================================================================
-- Viven como SPs propios para que las dos operaciones apliquen exactamente las
-- mismas reglas. Si maniana cambia una, cambia en un solo lugar.

-- -----------------------------------------------------------------------------
-- AssertMatchResult — coherencia entre ganador, diferencia y tipo de partido
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS AssertMatchResult;

DELIMITER //
CREATE PROCEDURE AssertMatchResult(
    pWinnerTeam     CHAR(1),
    pGoalsDiference INT,
    pIsDerby        BOOLEAN,
    pWasTracked     BOOLEAN
)
BEGIN
    DECLARE vWinnerIsDerbyTeam BOOLEAN;

    IF pWinnerTeam IS NOT NULL THEN
        SELECT isDerbyTeam INTO vWinnerIsDerbyTeam FROM Teams WHERE team = pWinnerTeam;

        IF vWinnerIsDerbyTeam IS NULL THEN
            SIGNAL SQLSTATE '45001' SET MYSQL_ERRNO = 46500,
                MESSAGE_TEXT = 'El equipo ganador no existe';
        END IF;

        IF vWinnerIsDerbyTeam <> pIsDerby THEN
            SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 46302,
                MESSAGE_TEXT = 'El equipo ganador no corresponde al tipo de partido';
        END IF;
    END IF;

    -- Empate: no puede haber diferencia de gol.
    IF (pWinnerTeam IS NULL) AND (pGoalsDiference <> 0) THEN
        SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 46304,
            MESSAGE_TEXT = 'Un empate no puede tener diferencia de gol';
    END IF;

    -- Victoria: exige margen, salvo en torneos sin marcadores registrados.
    IF (pWinnerTeam IS NOT NULL) AND (pGoalsDiference = 0) AND (pWasTracked = TRUE) THEN
        SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 46304,
            MESSAGE_TEXT = 'Una victoria necesita diferencia de gol mayor a cero';
    END IF;
END //
DELIMITER ;

-- -----------------------------------------------------------------------------
-- AssertLineup — valida la tabla temporal tmpLineup ya cargada
-- -----------------------------------------------------------------------------
-- pMatchId: NULL en un alta; en una edicion, el partido que se esta editando
-- (sus jugadores actuales quedan exceptuados del control de "activo").
DROP PROCEDURE IF EXISTS AssertLineup;

DELIMITER //
CREATE PROCEDURE AssertLineup(
    pWinnerTeam CHAR(1),
    pIsDerby    BOOLEAN,
    pMatchId    INT
)
BEGIN
    DECLARE vTotal    INT;
    DECLARE vDistinct INT;
    DECLARE vTeams    INT;

    SELECT COUNT(*), COUNT(DISTINCT playerId), COUNT(DISTINCT team)
      INTO vTotal, vDistinct, vTeams
    FROM tmpLineup;

    IF vTotal = 0 THEN
        SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 46301,
            MESSAGE_TEXT = 'El partido no tiene jugadores';
    END IF;

    IF EXISTS (SELECT 1 FROM tmpLineup WHERE playerId IS NULL OR team IS NULL) THEN
        SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 46301,
            MESSAGE_TEXT = 'Hay entradas de la convocatoria sin jugador o sin equipo';
    END IF;

    IF vDistinct <> vTotal THEN
        SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 46305,
            MESSAGE_TEXT = 'Un jugador aparece dos veces en el partido';
    END IF;

    IF vTeams > 2 THEN
        SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 46302,
            MESSAGE_TEXT = 'Un partido no puede tener mas de dos equipos';
    END IF;

    -- Los equipos convocados tienen que ser de la clase que corresponde:
    -- derby -> Sagrado / Resto del Mundo; normal -> Dark / Light.
    IF EXISTS (
        SELECT 1
        FROM tmpLineup l
        LEFT JOIN Teams t ON t.team = l.team
        WHERE t.team IS NULL OR t.isDerbyTeam <> pIsDerby
    ) THEN
        SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 46302,
            MESSAGE_TEXT = 'Los equipos no corresponden al tipo de partido';
    END IF;

    IF (pWinnerTeam IS NOT NULL)
        AND NOT EXISTS (SELECT 1 FROM tmpLineup WHERE team = pWinnerTeam) THEN
        SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 46303,
            MESSAGE_TEXT = 'El equipo ganador no jugo el partido';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM tmpLineup l
        LEFT JOIN Players p ON p.playerId = l.playerId
        WHERE p.playerId IS NULL
    ) THEN
        SIGNAL SQLSTATE '45001' SET MYSQL_ERRNO = 46100,
            MESSAGE_TEXT = 'Alguno de los jugadores convocados no existe';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM tmpLineup l
        INNER JOIN Players p ON p.playerId = l.playerId
        WHERE p.state <> 'A'
          AND (pMatchId IS NULL
               OR NOT EXISTS (SELECT 1 FROM MatchPlayers mp
                              WHERE mp.matchId = pMatchId AND mp.playerId = l.playerId))
    ) THEN
        SIGNAL SQLSTATE '45003' SET MYSQL_ERRNO = 46306,
            MESSAGE_TEXT = 'No se puede convocar a un jugador inactivo';
    END IF;
END //
DELIMITER ;

-- -----------------------------------------------------------------------------
-- SearchPlaces — canchas ya usadas
-- -----------------------------------------------------------------------------
-- No hay tabla de canchas: el lugar es texto libre en Matches. Este SP devuelve
-- los valores distintos ya cargados para que el frontend los sugiera al escribir.
--
-- Ordenado por uso y no alfabeticamente: la cancha de siempre queda primera, que
-- es la que se va a elegir en el 90% de los casos.
DROP PROCEDURE IF EXISTS SearchPlaces;

DELIMITER //
CREATE PROCEDURE SearchPlaces()
BEGIN
    SELECT
        place,
        CAST(COUNT(*) AS SIGNED) AS matches
    FROM Matches
    GROUP BY place
    ORDER BY matches DESC, place;
END //
DELIMITER ;
