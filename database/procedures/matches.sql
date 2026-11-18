-- =============================================================================
-- murieron-en-madrid — stored procedures del modulo matches
-- =============================================================================
-- SQLSTATE: 45000 validacion · 45001 no encontrado · 45002 conflicto
--           45003 estado invalido · 45004 prohibido · 45005 no autenticado
-- Codigos del modulo: 463xx (ver sp-error-codes.constants.ts)
--
-- Estos SPs escriben en varias tablas (Matches, MatchPlayers, MatchGuests,
-- MatchNotes), asi que corren en transaccion con un EXIT HANDLER que revierte y
-- re-señaliza. Como el handler corta la ejecucion, las validaciones se escriben
-- en secuencia (IF ... SIGNAL) en vez de la cadena ELSEIF del resto de los
-- modulos: son muchos controles y anidarlos los volveria ilegibles.
--
-- La convocatoria llega como JSON: [{"playerId": 1, "team": "D"}, ...], y los
-- randoms como [{"name": "Hernán", "team": null}, ...] (o con guestId cuando se
-- arman equipos). Se desarman con JSON_TABLE a tablas temporales para no
-- repetir el parseo en cada control.
--
-- Estados del partido (Matches.state):
--   P = en preparacion: convocados, quizas sin equipo; total impar permitido.
--   R = listo: equipos completos y parejos, sin resultado.
--   J = jugado: con resultado. El unico que cuenta para algo.
-- Con un team maker activo el partido no se edita: solo se cancela o reinicia
-- el maker (o se borra el partido).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- SearchMatches
-- -----------------------------------------------------------------------------
-- pIncludePending: TRUE solo para admins. Sin el, se ven los jugados y los
-- listos (estos ultimos son "el proximo partido", publico); los que estan en
-- preparacion no.
DROP PROCEDURE IF EXISTS SearchMatches;

DELIMITER //
CREATE PROCEDURE SearchMatches(
    pTournamentId   INT,
    pIsDerby        BOOLEAN,
    pPlayerId       INT,
    pIncludePending BOOLEAN
)
BEGIN
    SELECT
        matchId, tournamentId, tournamentName, winnerTeam, goalsDiference,
        place, playedAt, isDerby, state, players, guests
    FROM vMatchDetail m
    WHERE (pTournamentId IS NULL OR m.tournamentId = pTournamentId)
      AND (pIsDerby      IS NULL OR m.isDerby      = pIsDerby)
      AND (pPlayerId     IS NULL OR EXISTS (
            SELECT 1 FROM MatchPlayers mp
            WHERE mp.matchId = m.matchId AND mp.playerId = pPlayerId))
      AND (COALESCE(pIncludePending, FALSE) OR m.state IN ('J', 'R'))
    ORDER BY m.playedAt DESC, m.matchId DESC;
END //
DELIMITER ;

-- -----------------------------------------------------------------------------
-- GetMatchById
-- -----------------------------------------------------------------------------
-- NO devuelve las notas del administrador, y es a proposito: este SP alimenta
-- un endpoint publico y las notas son material privado del diario. Se leen por
-- GetMatchNotes, que sale detras de @AdminOnly(). Que un partido en
-- preparacion no lo vea cualquiera lo resuelve el service, que sabe si quien
-- pregunta es admin.
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
            place, playedAt, isDerby, state, players, guests
        FROM vMatchDetail
        WHERE matchId = pMatchId;
    END IF;
END //
DELIMITER ;

-- -----------------------------------------------------------------------------
-- GetUpcomingMatches — lo que alimenta la card de la portada y del torneo
-- -----------------------------------------------------------------------------
-- Los listos (proximo partido) y los que estan en preparacion con un team
-- maker activo (se estan eligiendo equipos en vivo). Del mas cercano al mas
-- lejano.
DROP PROCEDURE IF EXISTS GetUpcomingMatches;

DELIMITER //
CREATE PROCEDURE GetUpcomingMatches()
BEGIN
    SELECT
        matchId, tournamentId, tournamentName, winnerTeam, goalsDiference,
        place, playedAt, isDerby, state, players, guests
    FROM vMatchDetail m
    WHERE m.state = 'R'
       OR (m.state = 'P' AND EXISTS (
            SELECT 1 FROM TeamMakers tm WHERE tm.activeMatchId = m.matchId))
    ORDER BY m.playedAt, m.matchId;
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
--    tabla Teams es la que decide; no hay listas hardcodeadas. Quien es
--    isSagrado no importa: cualquiera puede ir a cualquier equipo.
--  · Empate <=> diferencia 0. La unica excepcion es un torneo wasTracked=FALSE,
--    donde se conoce el ganador pero no el marcador: ahi se admite ganador con
--    diferencia 0, que significa "no registrada".
--  · El ganador tiene que ser uno de los equipos que efectivamente jugaron.
--  · Nadie inactivo entra a una convocatoria, y nadie aparece dos veces.
--
-- pState: 'J' (default) carga un partido ya jugado, como siempre. 'P' crea uno
-- en preparacion: sin resultado, con equipos opcionales y total impar
-- permitido. 'R' no se crea: se llega armando equipos (SetMatchTeams).
--
-- Se admite una sola formacion cargada (un equipo) en un jugado: hay partidos
-- historicos donde solo se anoto quienes ganaron. Puntuan los presentes y listo.
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
    pNotes          TEXT,
    pState          CHAR(1),
    pGuests         JSON
)
BEGIN
    DECLARE vMatchId    INT;
    DECLARE vState      CHAR(1);
    DECLARE vWasTracked BOOLEAN;
    DECLARE vMatchState CHAR(1) DEFAULT COALESCE(pState, 'J');

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        DROP TEMPORARY TABLE IF EXISTS tmpLineup;
        DROP TEMPORARY TABLE IF EXISTS tmpGuests;
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

    IF vMatchState NOT IN ('P', 'J') THEN
        SIGNAL SQLSTATE '45003' SET MYSQL_ERRNO = 46307,
            MESSAGE_TEXT = 'Un partido nuevo solo puede estar en preparacion o jugado';
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

    CALL AssertStateResult(vMatchState, pWinnerTeam, pGoalsDiference, pIsDerby, vWasTracked);
    CALL LoadLineup(pPlayers, pGuests, NULL);
    CALL AssertLineup(pWinnerTeam, pIsDerby, NULL, vMatchState = 'J');

    START TRANSACTION;

    INSERT INTO Matches (tournamentId, winnerTeam, goalsDiference, place, playedAt, isDerby, state)
    VALUES (pTournamentId, pWinnerTeam, pGoalsDiference, pPlace, pPlayedAt, pIsDerby, vMatchState);

    SET vMatchId = LAST_INSERT_ID();

    INSERT INTO MatchPlayers (playerId, matchId, tournamentId, team)
    SELECT playerId, vMatchId, pTournamentId, team FROM tmpLineup;

    INSERT INTO MatchGuests (matchId, tournamentId, `name`, team)
    SELECT vMatchId, pTournamentId, `name`, team FROM tmpGuests;

    -- Adentro de la transaccion: si el partido no se crea, las notas tampoco.
    IF (pNotes IS NOT NULL) AND (TRIM(pNotes) <> '') THEN
        INSERT INTO MatchNotes (matchId, notes) VALUES (vMatchId, TRIM(pNotes));
    END IF;

    COMMIT;

    DROP TEMPORARY TABLE IF EXISTS tmpLineup;
    DROP TEMPORARY TABLE IF EXISTS tmpGuests;

    SELECT
        matchId, tournamentId, tournamentName, winnerTeam, goalsDiference,
        place, playedAt, isDerby, state, players, guests
    FROM vMatchDetail
    WHERE matchId = vMatchId;
END //
DELIMITER ;

-- -----------------------------------------------------------------------------
-- UpdateMatch — reemplaza el partido entero, convocatoria y randoms incluidos
-- -----------------------------------------------------------------------------
-- No intenta un diff de la formacion: borra la vieja y escribe la nueva dentro
-- de la misma transaccion. Es mas simple de leer y deja el mismo resultado.
--
-- No cambia el estado: pState tiene que ser el que el partido ya tiene (es la
-- forma de que el cliente diga explicitamente que esta editando). Las
-- transiciones tienen SPs propios: SetMatchTeams, ClearMatchTeams, FinishMatch.
--
-- Un jugador que ya estaba en este partido se acepta aunque hoy este inactivo.
-- Si no, dar de baja a alguien congelaria para siempre los partidos que jugo,
-- que es exactamente al reves de lo que se quiere.
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
    pNotes          TEXT,
    pState          CHAR(1),
    pGuests         JSON
)
BEGIN
    DECLARE vTournamentId INT;
    DECLARE vState        CHAR(1);
    DECLARE vWasTracked   BOOLEAN;
    DECLARE vMatchState   CHAR(1);

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        DROP TEMPORARY TABLE IF EXISTS tmpLineup;
        DROP TEMPORARY TABLE IF EXISTS tmpGuests;
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

    SELECT m.tournamentId, t.state, t.wasTracked, m.state
      INTO vTournamentId, vState, vWasTracked, vMatchState
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

    IF COALESCE(pState, 'J') <> vMatchState THEN
        SIGNAL SQLSTATE '45003' SET MYSQL_ERRNO = 46307,
            MESSAGE_TEXT = 'Editar no cambia el estado del partido';
    END IF;

    CALL AssertNoActiveMaker(pMatchId);
    CALL AssertStateResult(vMatchState, pWinnerTeam, pGoalsDiference, pIsDerby, vWasTracked);
    CALL LoadLineup(pPlayers, pGuests, NULL);
    CALL AssertLineup(pWinnerTeam, pIsDerby, pMatchId, vMatchState IN ('R', 'J'));

    START TRANSACTION;

    UPDATE Matches
    SET winnerTeam     = pWinnerTeam,
        goalsDiference = pGoalsDiference,
        place          = pPlace,
        playedAt       = pPlayedAt,
        isDerby        = pIsDerby
    WHERE matchId = pMatchId;

    DELETE FROM MatchPlayers WHERE matchId = pMatchId;
    DELETE FROM MatchGuests  WHERE matchId = pMatchId;

    INSERT INTO MatchPlayers (playerId, matchId, tournamentId, team)
    SELECT playerId, pMatchId, vTournamentId, team FROM tmpLineup;

    INSERT INTO MatchGuests (matchId, tournamentId, `name`, team)
    SELECT pMatchId, vTournamentId, `name`, team FROM tmpGuests;

    -- Un partido listo tiene que seguir con equipos completos y parejos.
    IF vMatchState = 'R' THEN
        CALL AssertTeamsComplete(pMatchId);
    END IF;

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
    DROP TEMPORARY TABLE IF EXISTS tmpGuests;

    SELECT
        matchId, tournamentId, tournamentName, winnerTeam, goalsDiference,
        place, playedAt, isDerby, state, players, guests
    FROM vMatchDetail
    WHERE matchId = pMatchId;
END //
DELIMITER ;

-- -----------------------------------------------------------------------------
-- SetMatchTeams — armar equipos a mano: en preparacion -> listo
-- -----------------------------------------------------------------------------
-- No cambia QUIENES van, solo en que equipo: la convocatoria y los randoms que
-- llegan tienen que ser exactamente los que el partido ya tiene. Los randoms se
-- identifican por guestId.
DROP PROCEDURE IF EXISTS SetMatchTeams;

DELIMITER //
CREATE PROCEDURE SetMatchTeams(
    pMatchId INT,
    pPlayers JSON,
    pGuests  JSON
)
BEGIN
    DECLARE vIsDerby    BOOLEAN;
    DECLARE vSent       INT;
    DECLARE vMatching   INT;
    DECLARE vSentGuests INT;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        DROP TEMPORARY TABLE IF EXISTS tmpLineup;
        DROP TEMPORARY TABLE IF EXISTS tmpGuests;
        RESIGNAL;
    END;

    IF (pMatchId IS NULL) OR (pMatchId < 1) OR (pPlayers IS NULL) THEN
        SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 46000,
            MESSAGE_TEXT = 'Datos invalidos para armar los equipos';
    END IF;

    CALL AssertMatchInState(pMatchId, 'P');
    CALL AssertNoActiveMaker(pMatchId);

    SELECT isDerby INTO vIsDerby FROM Matches WHERE matchId = pMatchId;

    CALL LoadLineup(pPlayers, pGuests, pMatchId);
    CALL AssertLineup(NULL, vIsDerby, pMatchId, TRUE);

    -- Mismo conjunto de convocados y de randoms que el partido ya tiene. Los
    -- conteos van a variables: MySQL no deja abrir la misma tabla temporal dos
    -- veces en una consulta.
    SELECT COUNT(*) INTO vSent FROM tmpLineup;
    SELECT COUNT(*) INTO vMatching
    FROM tmpLineup l
    INNER JOIN MatchPlayers mp ON mp.matchId = pMatchId AND mp.playerId = l.playerId;
    SELECT COUNT(*) INTO vSentGuests FROM tmpGuests;

    IF vSent <> vMatching
        OR vSent <> (SELECT COUNT(*) FROM MatchPlayers WHERE matchId = pMatchId)
        OR vSentGuests <> (SELECT COUNT(*) FROM MatchGuests WHERE matchId = pMatchId) THEN
        SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 46301,
            MESSAGE_TEXT = 'Los equipos no coinciden con la convocatoria del partido';
    END IF;

    START TRANSACTION;

    UPDATE MatchPlayers mp
    INNER JOIN tmpLineup l ON l.playerId = mp.playerId
    SET mp.team = l.team
    WHERE mp.matchId = pMatchId;

    UPDATE MatchGuests g
    INNER JOIN tmpGuests t ON t.guestId = g.guestId
    SET g.team = t.team
    WHERE g.matchId = pMatchId;

    CALL AssertTeamsComplete(pMatchId);

    UPDATE Matches SET state = 'R' WHERE matchId = pMatchId;

    COMMIT;

    DROP TEMPORARY TABLE IF EXISTS tmpLineup;
    DROP TEMPORARY TABLE IF EXISTS tmpGuests;

    SELECT
        matchId, tournamentId, tournamentName, winnerTeam, goalsDiference,
        place, playedAt, isDerby, state, players, guests
    FROM vMatchDetail
    WHERE matchId = pMatchId;
END //
DELIMITER ;

-- -----------------------------------------------------------------------------
-- ClearMatchTeams — deshacer equipos: listo -> en preparacion
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS ClearMatchTeams;

DELIMITER //
CREATE PROCEDURE ClearMatchTeams(
    pMatchId INT
)
BEGIN
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    IF (pMatchId IS NULL) OR (pMatchId < 1) THEN
        SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 46000,
            MESSAGE_TEXT = 'Identificador de partido invalido';
    END IF;

    CALL AssertMatchInState(pMatchId, 'R');

    START TRANSACTION;
    UPDATE MatchPlayers SET team = NULL WHERE matchId = pMatchId;
    UPDATE MatchGuests  SET team = NULL WHERE matchId = pMatchId;
    UPDATE Matches      SET state = 'P' WHERE matchId = pMatchId;
    COMMIT;

    SELECT
        matchId, tournamentId, tournamentName, winnerTeam, goalsDiference,
        place, playedAt, isDerby, state, players, guests
    FROM vMatchDetail
    WHERE matchId = pMatchId;
END //
DELIMITER ;

-- -----------------------------------------------------------------------------
-- FinishMatch — cargar el resultado: listo -> jugado
-- -----------------------------------------------------------------------------
-- Desde aca el partido cuenta: tablas, logros, mundialito y diario lo ven.
DROP PROCEDURE IF EXISTS FinishMatch;

DELIMITER //
CREATE PROCEDURE FinishMatch(
    pMatchId        INT,
    pWinnerTeam     CHAR(1),
    pGoalsDiference INT,
    pNotes          TEXT
)
BEGIN
    DECLARE vIsDerby    BOOLEAN;
    DECLARE vWasTracked BOOLEAN;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    IF (pMatchId IS NULL) OR (pMatchId < 1)
        OR (pGoalsDiference IS NULL) OR (pGoalsDiference < 0) THEN
        SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 46000,
            MESSAGE_TEXT = 'Datos invalidos para finalizar el partido';
    END IF;

    CALL AssertMatchInState(pMatchId, 'R');

    SELECT m.isDerby, t.wasTracked INTO vIsDerby, vWasTracked
    FROM Matches m
    INNER JOIN Tournaments t ON t.tournamentId = m.tournamentId
    WHERE m.matchId = pMatchId;

    CALL AssertMatchResult(pWinnerTeam, pGoalsDiference, vIsDerby, vWasTracked);

    IF (pWinnerTeam IS NOT NULL) AND NOT EXISTS (
        SELECT 1 FROM MatchPlayers WHERE matchId = pMatchId AND team = pWinnerTeam
        UNION ALL
        SELECT 1 FROM MatchGuests  WHERE matchId = pMatchId AND team = pWinnerTeam) THEN
        SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 46303,
            MESSAGE_TEXT = 'El equipo ganador no jugo el partido';
    END IF;

    START TRANSACTION;

    UPDATE Matches
    SET winnerTeam     = pWinnerTeam,
        goalsDiference = pGoalsDiference,
        state          = 'J'
    WHERE matchId = pMatchId;

    IF (pNotes IS NULL) OR (TRIM(pNotes) = '') THEN
        DELETE FROM MatchNotes WHERE matchId = pMatchId;
    ELSE
        INSERT INTO MatchNotes (matchId, notes) VALUES (pMatchId, TRIM(pNotes))
        ON DUPLICATE KEY UPDATE notes = VALUES(notes);
    END IF;

    COMMIT;

    SELECT
        matchId, tournamentId, tournamentName, winnerTeam, goalsDiference,
        place, playedAt, isDerby, state, players, guests
    FROM vMatchDetail
    WHERE matchId = pMatchId;
END //
DELIMITER ;

-- -----------------------------------------------------------------------------
-- DeleteMatch — solo de un torneo en juego
-- -----------------------------------------------------------------------------
-- Convocatoria, randoms, notas y team maker se van solos: todos tienen
-- ON DELETE CASCADE hacia Matches. La fila se devuelve capturada antes del
-- borrado.
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
                place, playedAt, isDerby, state, players, guests
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
-- Helpers de validacion — compartidos por los SPs de escritura
-- =============================================================================
-- Viven como SPs propios para que todas las operaciones apliquen exactamente
-- las mismas reglas. Si maniana cambia una, cambia en un solo lugar.

-- -----------------------------------------------------------------------------
-- AssertMatchInState — el partido existe, su torneo esta en juego y esta en pState
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS AssertMatchInState;

DELIMITER //
CREATE PROCEDURE AssertMatchInState(
    pMatchId INT,
    pState   CHAR(1)
)
BEGIN
    DECLARE vMatchState      CHAR(1);
    DECLARE vTournamentState CHAR(1);

    SELECT m.state, t.state INTO vMatchState, vTournamentState
    FROM Matches m
    INNER JOIN Tournaments t ON t.tournamentId = m.tournamentId
    WHERE m.matchId = pMatchId;

    IF vMatchState IS NULL THEN
        SIGNAL SQLSTATE '45001' SET MYSQL_ERRNO = 46300,
            MESSAGE_TEXT = 'El partido no existe';
    END IF;

    IF vTournamentState <> 'P' THEN
        SIGNAL SQLSTATE '45003' SET MYSQL_ERRNO = 46202,
            MESSAGE_TEXT = 'El torneo esta finalizado: sus partidos no se editan';
    END IF;

    IF vMatchState <> pState THEN
        SIGNAL SQLSTATE '45003' SET MYSQL_ERRNO = 46307,
            MESSAGE_TEXT = 'El partido no esta en el estado que la operacion necesita';
    END IF;
END //
DELIMITER ;

-- -----------------------------------------------------------------------------
-- AssertNoActiveMaker — con un team maker en curso el partido no se toca
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS AssertNoActiveMaker;

DELIMITER //
CREATE PROCEDURE AssertNoActiveMaker(
    pMatchId INT
)
BEGIN
    IF EXISTS (SELECT 1 FROM TeamMakers WHERE activeMatchId = pMatchId) THEN
        SIGNAL SQLSTATE '45003' SET MYSQL_ERRNO = 46309,
            MESSAGE_TEXT = 'Hay un team maker en curso: cancelalo o reinicialo primero';
    END IF;
END //
DELIMITER ;

-- -----------------------------------------------------------------------------
-- AssertStateResult — el resultado que corresponde a cada estado
-- -----------------------------------------------------------------------------
-- Un partido que no se jugo no tiene resultado; uno jugado se valida con las
-- reglas de siempre.
DROP PROCEDURE IF EXISTS AssertStateResult;

DELIMITER //
CREATE PROCEDURE AssertStateResult(
    pMatchState     CHAR(1),
    pWinnerTeam     CHAR(1),
    pGoalsDiference INT,
    pIsDerby        BOOLEAN,
    pWasTracked     BOOLEAN
)
BEGIN
    IF pMatchState = 'J' THEN
        CALL AssertMatchResult(pWinnerTeam, pGoalsDiference, pIsDerby, pWasTracked);
    ELSEIF (pWinnerTeam IS NOT NULL) OR (pGoalsDiference <> 0) THEN
        SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 46304,
            MESSAGE_TEXT = 'Un partido que no se jugo no tiene resultado';
    END IF;
END //
DELIMITER ;

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
-- LoadLineup — desarma convocatoria y randoms a tmpLineup / tmpGuests
-- -----------------------------------------------------------------------------
-- pMatchId NULL: los randoms llegan por nombre (alta o edicion).
-- pMatchId dado: llegan por guestId (armar equipos) y el nombre se toma de la
-- base; un guestId que no es de este partido queda afuera y el conteo de
-- SetMatchTeams lo detecta.
DROP PROCEDURE IF EXISTS LoadLineup;

DELIMITER //
CREATE PROCEDURE LoadLineup(
    pPlayers JSON,
    pGuests  JSON,
    pMatchId INT
)
BEGIN
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

    DROP TEMPORARY TABLE IF EXISTS tmpGuests;
    CREATE TEMPORARY TABLE tmpGuests (
        guestId INT          NULL,
        `name`  VARCHAR(20)  NULL,
        team    VARCHAR(1)   NULL
    ) ENGINE = MEMORY;

    IF pMatchId IS NULL THEN
        INSERT INTO tmpGuests (guestId, `name`, team)
        SELECT NULL, TRIM(jt.`name`), jt.team
        FROM JSON_TABLE(COALESCE(pGuests, JSON_ARRAY()), '$[*]' COLUMNS (
            `name` VARCHAR(20) PATH '$.name',
            team   VARCHAR(1)  PATH '$.team'
        )) AS jt;
    ELSE
        INSERT INTO tmpGuests (guestId, `name`, team)
        SELECT g.guestId, g.`name`, jt.team
        FROM JSON_TABLE(COALESCE(pGuests, JSON_ARRAY()), '$[*]' COLUMNS (
            guestId INT        PATH '$.guestId',
            team    VARCHAR(1) PATH '$.team'
        )) AS jt
        INNER JOIN MatchGuests g ON g.guestId = jt.guestId AND g.matchId = pMatchId;
    END IF;
END //
DELIMITER ;

-- -----------------------------------------------------------------------------
-- AssertLineup — valida tmpLineup y tmpGuests ya cargadas
-- -----------------------------------------------------------------------------
-- pMatchId: NULL en un alta; en una edicion, el partido que se esta editando
-- (sus jugadores actuales quedan exceptuados del control de "activo").
-- pRequireTeams: TRUE para listos y jugados; en preparacion el equipo es
-- opcional, pero si viene tiene que ser valido.
DROP PROCEDURE IF EXISTS AssertLineup;

DELIMITER //
CREATE PROCEDURE AssertLineup(
    pWinnerTeam   CHAR(1),
    pIsDerby      BOOLEAN,
    pMatchId      INT,
    pRequireTeams BOOLEAN
)
BEGIN
    DECLARE vTotal      INT;
    DECLARE vDistinct   INT;
    DECLARE vTeams      INT;
    DECLARE vGuests     INT;
    DECLARE vGuestNames INT;

    SELECT COUNT(*), COUNT(DISTINCT playerId) INTO vTotal, vDistinct FROM tmpLineup;

    SELECT COUNT(DISTINCT team) INTO vTeams
    FROM (SELECT team FROM tmpLineup UNION ALL SELECT team FROM tmpGuests) all_teams;

    IF vTotal = 0 THEN
        SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 46301,
            MESSAGE_TEXT = 'El partido no tiene jugadores';
    END IF;

    IF EXISTS (SELECT 1 FROM tmpLineup WHERE playerId IS NULL) THEN
        SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 46301,
            MESSAGE_TEXT = 'Hay entradas de la convocatoria sin jugador';
    END IF;

    IF pRequireTeams AND (
        EXISTS (SELECT 1 FROM tmpLineup WHERE team IS NULL)
        OR EXISTS (SELECT 1 FROM tmpGuests WHERE team IS NULL)) THEN
        SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 46301,
            MESSAGE_TEXT = 'Hay convocados sin equipo';
    END IF;

    IF EXISTS (SELECT 1 FROM tmpGuests WHERE `name` IS NULL OR `name` = '') THEN
        SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 46301,
            MESSAGE_TEXT = 'Hay un random sin nombre';
    END IF;

    IF vDistinct <> vTotal THEN
        SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 46305,
            MESSAGE_TEXT = 'Un jugador aparece dos veces en el partido';
    END IF;

    -- En dos sentencias: MySQL no deja abrir la misma tabla temporal dos veces
    -- en una consulta.
    SELECT COUNT(*), COUNT(DISTINCT `name`) INTO vGuests, vGuestNames FROM tmpGuests;

    IF vGuests <> vGuestNames THEN
        SIGNAL SQLSTATE '45002' SET MYSQL_ERRNO = 46310,
            MESSAGE_TEXT = 'Dos randoms con el mismo nombre en el partido';
    END IF;

    IF vTeams > 2 THEN
        SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 46302,
            MESSAGE_TEXT = 'Un partido no puede tener mas de dos equipos';
    END IF;

    -- Los equipos tienen que ser de la clase que corresponde:
    -- derby -> Sagrado / Resto del Mundo; normal -> Dark / Light.
    IF EXISTS (
        SELECT 1
        FROM (SELECT team FROM tmpLineup UNION ALL SELECT team FROM tmpGuests) l
        LEFT JOIN Teams t ON t.team = l.team
        WHERE l.team IS NOT NULL AND (t.team IS NULL OR t.isDerbyTeam <> pIsDerby)
    ) THEN
        SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 46302,
            MESSAGE_TEXT = 'Los equipos no corresponden al tipo de partido';
    END IF;

    IF (pWinnerTeam IS NOT NULL)
        AND NOT EXISTS (SELECT 1 FROM tmpLineup WHERE team = pWinnerTeam)
        AND NOT EXISTS (SELECT 1 FROM tmpGuests WHERE team = pWinnerTeam) THEN
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
-- AssertTeamsComplete — un partido listo: todos con equipo, par y parejo
-- -----------------------------------------------------------------------------
-- Mira lo que ya esta escrito en MatchPlayers + MatchGuests (se llama dentro de
-- la transaccion, despues de escribir): si falla, el EXIT HANDLER del SP que lo
-- llamo revierte todo.
DROP PROCEDURE IF EXISTS AssertTeamsComplete;

DELIMITER //
CREATE PROCEDURE AssertTeamsComplete(
    pMatchId INT
)
BEGIN
    DECLARE vTotal    INT;
    DECLARE vNoTeam   INT;
    DECLARE vTeams    INT;
    DECLARE vBiggest  INT;

    SELECT COUNT(*), SUM(team IS NULL), COUNT(DISTINCT team)
      INTO vTotal, vNoTeam, vTeams
    FROM (
        SELECT team FROM MatchPlayers WHERE matchId = pMatchId
        UNION ALL
        SELECT team FROM MatchGuests  WHERE matchId = pMatchId
    ) everyone;

    IF vNoTeam > 0 THEN
        SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 46301,
            MESSAGE_TEXT = 'Hay convocados sin equipo';
    END IF;

    IF (vTotal < 4) OR (vTotal % 2 <> 0) THEN
        SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 46308,
            MESSAGE_TEXT = 'Para armar equipos hace falta un total par de al menos 4';
    END IF;

    SELECT MAX(n) INTO vBiggest
    FROM (
        SELECT team, COUNT(*) AS n FROM (
            SELECT team FROM MatchPlayers WHERE matchId = pMatchId
            UNION ALL
            SELECT team FROM MatchGuests  WHERE matchId = pMatchId
        ) everyone
        GROUP BY team
    ) sizes;

    IF (vTeams <> 2) OR (vBiggest <> vTotal / 2) THEN
        SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 46302,
            MESSAGE_TEXT = 'Los equipos tienen que ser dos y del mismo tamanio';
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
