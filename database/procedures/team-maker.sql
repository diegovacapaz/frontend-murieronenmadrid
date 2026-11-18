-- =============================================================================
-- murieron-en-madrid — stored procedures del team maker
-- =============================================================================
-- SQLSTATE: 45000 validacion · 45001 no encontrado · 45002 conflicto
--           45003 estado invalido
-- Codigos del modulo: 466xx (ver sp-error-codes.constants.ts)
--
-- El servidor es la unica autoridad del armado: estos SPs guardan cada paso
-- ANTES de que se difunda, para que si la API se reinicia el armado se pueda
-- rearmar desde aca. Las reglas de turno (de quien es, cual es el ultimo) las
-- decide el service con las reglas puras de team-maker.rules.ts; aca se
-- garantiza la integridad: lugares, convocados, una eleccion por turno.
--
-- Estados del maker: W esperando capitanes · K eligiendo · V votando color ·
-- F terminado · C cancelado.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- AssertTeamMakerInState — el maker existe y esta en alguno de los estados
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS AssertTeamMakerInState;

DELIMITER //
CREATE PROCEDURE AssertTeamMakerInState(
    pMakerId INT,
    pStates  VARCHAR(5)
)
BEGIN
    DECLARE vState CHAR(1);

    SELECT state INTO vState FROM TeamMakers WHERE makerId = pMakerId;

    IF vState IS NULL THEN
        SIGNAL SQLSTATE '45001' SET MYSQL_ERRNO = 46600,
            MESSAGE_TEXT = 'El team maker no existe';
    END IF;

    IF LOCATE(vState, pStates) = 0 THEN
        SIGNAL SQLSTATE '45003' SET MYSQL_ERRNO = 46601,
            MESSAGE_TEXT = 'El team maker no esta en el estado que la operacion necesita';
    END IF;
END //
DELIMITER ;

-- -----------------------------------------------------------------------------
-- CreateTeamMaker — abrir la eleccion en vivo de un partido en preparacion
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS CreateTeamMaker;

DELIMITER //
CREATE PROCEDURE CreateTeamMaker(
    pMatchId     INT,
    pCaptainCode CHAR(22)
)
BEGIN
    DECLARE vMakerId INT;
    DECLARE vTotal   INT;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    IF (pMatchId IS NULL) OR (pMatchId < 1) OR (pCaptainCode IS NULL) THEN
        SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 46000,
            MESSAGE_TEXT = 'Datos invalidos para abrir el team maker';
    END IF;

    CALL AssertMatchInState(pMatchId, 'P');
    CALL AssertNoActiveMaker(pMatchId);

    SELECT (SELECT COUNT(*) FROM MatchPlayers WHERE matchId = pMatchId)
         + (SELECT COUNT(*) FROM MatchGuests  WHERE matchId = pMatchId)
      INTO vTotal;

    IF (vTotal < 4) OR (vTotal % 2 <> 0) THEN
        SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 46308,
            MESSAGE_TEXT = 'Para armar equipos hace falta un total par de al menos 4';
    END IF;

    START TRANSACTION;
    INSERT INTO TeamMakers (matchId, captainCode) VALUES (pMatchId, pCaptainCode);
    SET vMakerId = LAST_INSERT_ID();
    INSERT INTO TeamMakerSeats (makerId, seat) VALUES (vMakerId, 0), (vMakerId, 1);
    COMMIT;

    SELECT vMakerId AS makerId, pCaptainCode AS captainCode, 'W' AS state;
END //
DELIMITER ;

-- -----------------------------------------------------------------------------
-- GetTeamMakerByMatch — todo lo necesario para rearmar el estado
-- -----------------------------------------------------------------------------
-- Cuatro result sets: el maker (el activo o, si no hay, el ultimo), sus dos
-- lugares, sus elecciones y la convocatoria del partido (jugadores y randoms).
-- Sin maker, el primer result set viene vacio.
DROP PROCEDURE IF EXISTS GetTeamMakerByMatch;

DELIMITER //
CREATE PROCEDURE GetTeamMakerByMatch(
    pMatchId INT
)
BEGIN
    DECLARE vMakerId INT;

    SELECT makerId INTO vMakerId
    FROM TeamMakers
    WHERE matchId = pMatchId
    ORDER BY (activeMatchId IS NULL), makerId DESC
    LIMIT 1;

    SELECT
        tm.makerId, tm.matchId, m.tournamentId, m.isDerby, tm.state, tm.captainCode,
        tm.firstSeat, tm.firstByDraw, tm.coinWinner
    FROM TeamMakers tm
    INNER JOIN Matches m ON m.matchId = tm.matchId
    WHERE tm.makerId = vMakerId;

    SELECT s.seat, s.playerId, s.tokenHash, s.vote, p.displayName AS `name`, p.photo
    FROM TeamMakerSeats s
    LEFT JOIN vPlayerDetail p ON p.playerId = s.playerId
    WHERE s.makerId = vMakerId
    ORDER BY s.seat;

    SELECT turn, seat, playerId, guestId
    FROM TeamMakerPicks
    WHERE makerId = vMakerId
    ORDER BY turn;

    SELECT 'P' AS kind, mp.playerId AS id, p.displayName AS `name`, p.photo
    FROM MatchPlayers mp
    INNER JOIN vPlayerDetail p ON p.playerId = mp.playerId
    WHERE mp.matchId = pMatchId
    UNION ALL
    SELECT 'G' AS kind, g.guestId AS id, g.`name`, NULL AS photo
    FROM MatchGuests g
    WHERE g.matchId = pMatchId
    ORDER BY kind DESC, `name`;
END //
DELIMITER ;

-- -----------------------------------------------------------------------------
-- ClaimTeamMakerSeat — marcarse como capitan (o volver al propio lugar)
-- -----------------------------------------------------------------------------
-- Un lugar libre lo toma cualquier jugador real convocado que no este en el
-- otro lugar. Un lugar ya tomado solo lo puede volver a tomar el mismo jugador
-- (el capitan que se cayo y vuelve): el token nuevo reemplaza al viejo.
DROP PROCEDURE IF EXISTS ClaimTeamMakerSeat;

DELIMITER //
CREATE PROCEDURE ClaimTeamMakerSeat(
    pMakerId   INT,
    pSeat      TINYINT,
    pPlayerId  INT,
    pTokenHash CHAR(64)
)
BEGIN
    DECLARE vMatchId  INT;
    DECLARE vCurrent  INT;
    DECLARE vOther    INT;

    IF (pMakerId IS NULL) OR (pSeat NOT IN (0, 1)) OR (pPlayerId IS NULL) OR (pTokenHash IS NULL) THEN
        SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 46000,
            MESSAGE_TEXT = 'Datos invalidos para marcarse como capitan';
    END IF;

    CALL AssertTeamMakerInState(pMakerId, 'WKV');

    SELECT matchId INTO vMatchId FROM TeamMakers WHERE makerId = pMakerId;
    SELECT playerId INTO vCurrent FROM TeamMakerSeats WHERE makerId = pMakerId AND seat = pSeat;
    SELECT playerId INTO vOther   FROM TeamMakerSeats WHERE makerId = pMakerId AND seat <> pSeat;

    IF NOT EXISTS (SELECT 1 FROM MatchPlayers WHERE matchId = vMatchId AND playerId = pPlayerId) THEN
        SIGNAL SQLSTATE '45003' SET MYSQL_ERRNO = 46601,
            MESSAGE_TEXT = 'Solo un jugador convocado (no un random) puede ser capitan';
    END IF;

    IF (vCurrent IS NOT NULL AND vCurrent <> pPlayerId) OR (vOther <=> pPlayerId) THEN
        SIGNAL SQLSTATE '45003' SET MYSQL_ERRNO = 46601,
            MESSAGE_TEXT = 'Ese lugar o ese jugador ya estan tomados';
    END IF;

    UPDATE TeamMakerSeats
    SET playerId = pPlayerId, tokenHash = pTokenHash
    WHERE makerId = pMakerId AND seat = pSeat;

    SELECT pSeat AS seat, pPlayerId AS playerId;
END //
DELIMITER ;

-- -----------------------------------------------------------------------------
-- GetCaptainPositions — donde esta cada capitan en la tabla del torneo
-- -----------------------------------------------------------------------------
-- RANK y no la posicion de vTournamentStandings: esa desempata por playerId
-- para que nunca haya dos iguales, y aca un empate real (mismos puntos,
-- diferencia y efectividad) tiene que verse como empate para sortear. NULL si
-- el capitan todavia no jugo en el torneo.
DROP PROCEDURE IF EXISTS GetCaptainPositions;

DELIMITER //
CREATE PROCEDURE GetCaptainPositions(
    pMatchId   INT,
    pPlayerId0 INT,
    pPlayerId1 INT
)
BEGIN
    DECLARE vTournamentId INT;

    SELECT tournamentId INTO vTournamentId FROM Matches WHERE matchId = pMatchId;

    -- Un agregado sobre un conjunto vacio igual devuelve una fila: si nadie
    -- jugo todavia, salen los dos NULL.
    SELECT
        CAST(MAX(CASE WHEN r.playerId = pPlayerId0 THEN r.rnk END) AS SIGNED) AS pos0,
        CAST(MAX(CASE WHEN r.playerId = pPlayerId1 THEN r.rnk END) AS SIGNED) AS pos1
    FROM (
        SELECT
            s.playerId,
            RANK() OVER (ORDER BY s.netPoints DESC, s.goalsDiference DESC, s.winRate DESC) AS rnk
        FROM vTournamentScoreboard s
        WHERE s.tournamentId = vTournamentId
    ) r;
END //
DELIMITER ;

-- -----------------------------------------------------------------------------
-- StartTeamMakerPicking — los dos capitanes estan: arranca la eleccion
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS StartTeamMakerPicking;

DELIMITER //
CREATE PROCEDURE StartTeamMakerPicking(
    pMakerId    INT,
    pFirstSeat  TINYINT,
    pFirstByDraw BOOLEAN
)
BEGIN
    CALL AssertTeamMakerInState(pMakerId, 'W');

    IF EXISTS (SELECT 1 FROM TeamMakerSeats WHERE makerId = pMakerId AND playerId IS NULL) THEN
        SIGNAL SQLSTATE '45003' SET MYSQL_ERRNO = 46601,
            MESSAGE_TEXT = 'Faltan capitanes';
    END IF;

    UPDATE TeamMakers
    SET state = 'K', firstSeat = pFirstSeat, firstByDraw = COALESCE(pFirstByDraw, FALSE)
    WHERE makerId = pMakerId;
END //
DELIMITER ;

-- -----------------------------------------------------------------------------
-- AddTeamMakerPick — una eleccion
-- -----------------------------------------------------------------------------
-- La PK (makerId, turn) es la que hace imposible que un turno se juegue dos
-- veces aunque lleguen dos pedidos a la vez. pLast lo decide el service (que
-- conoce el orden): con la ultima eleccion el maker pasa a votar color.
DROP PROCEDURE IF EXISTS AddTeamMakerPick;

DELIMITER //
CREATE PROCEDURE AddTeamMakerPick(
    pMakerId  INT,
    pTurn     TINYINT,
    pSeat     TINYINT,
    pPlayerId INT,
    pGuestId  INT,
    pLast     BOOLEAN
)
BEGIN
    DECLARE vMatchId INT;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    CALL AssertTeamMakerInState(pMakerId, 'K');

    SELECT matchId INTO vMatchId FROM TeamMakers WHERE makerId = pMakerId;

    IF (pPlayerId IS NOT NULL AND (
            NOT EXISTS (SELECT 1 FROM MatchPlayers WHERE matchId = vMatchId AND playerId = pPlayerId)
            OR EXISTS (SELECT 1 FROM TeamMakerSeats WHERE makerId = pMakerId AND playerId = pPlayerId)))
        OR (pGuestId IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM MatchGuests WHERE matchId = vMatchId AND guestId = pGuestId)) THEN
        SIGNAL SQLSTATE '45003' SET MYSQL_ERRNO = 46601,
            MESSAGE_TEXT = 'Ese jugador no se puede elegir';
    END IF;

    START TRANSACTION;
    INSERT INTO TeamMakerPicks (makerId, turn, seat, playerId, guestId)
    VALUES (pMakerId, pTurn, pSeat, pPlayerId, pGuestId);

    IF pLast THEN
        UPDATE TeamMakers SET state = 'V' WHERE makerId = pMakerId;
    END IF;
    COMMIT;
END //
DELIMITER ;

-- -----------------------------------------------------------------------------
-- SetTeamMakerVote — el color que vota un capitan
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS SetTeamMakerVote;

DELIMITER //
CREATE PROCEDURE SetTeamMakerVote(
    pMakerId INT,
    pSeat    TINYINT,
    pVote    CHAR(1)
)
BEGIN
    DECLARE vIsDerby BOOLEAN;

    CALL AssertTeamMakerInState(pMakerId, 'V');

    SELECT m.isDerby INTO vIsDerby
    FROM TeamMakers tm INNER JOIN Matches m ON m.matchId = tm.matchId
    WHERE tm.makerId = pMakerId;

    IF NOT EXISTS (SELECT 1 FROM Teams WHERE team = pVote AND isDerbyTeam = vIsDerby) THEN
        SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 46302,
            MESSAGE_TEXT = 'Ese color no corresponde al tipo de partido';
    END IF;

    UPDATE TeamMakerSeats SET vote = pVote WHERE makerId = pMakerId AND seat = pSeat;
END //
DELIMITER ;

-- -----------------------------------------------------------------------------
-- FinishTeamMaker — colores resueltos: los equipos quedan escritos
-- -----------------------------------------------------------------------------
-- Cada capitan y lo que eligio van al color de su lugar. El partido pasa a
-- listo y el maker queda terminado (con capitanes, orden y moneda guardados).
DROP PROCEDURE IF EXISTS FinishTeamMaker;

DELIMITER //
CREATE PROCEDURE FinishTeamMaker(
    pMakerId    INT,
    pColor0     CHAR(1),
    pColor1     CHAR(1),
    pCoinWinner TINYINT
)
BEGIN
    DECLARE vMatchId INT;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    CALL AssertTeamMakerInState(pMakerId, 'V');

    SELECT matchId INTO vMatchId FROM TeamMakers WHERE makerId = pMakerId;

    START TRANSACTION;

    UPDATE MatchPlayers mp
    INNER JOIN TeamMakerSeats s ON s.makerId = pMakerId AND s.playerId = mp.playerId
    SET mp.team = IF(s.seat = 0, pColor0, pColor1)
    WHERE mp.matchId = vMatchId;

    UPDATE MatchPlayers mp
    INNER JOIN TeamMakerPicks pk ON pk.makerId = pMakerId AND pk.playerId = mp.playerId
    SET mp.team = IF(pk.seat = 0, pColor0, pColor1)
    WHERE mp.matchId = vMatchId;

    UPDATE MatchGuests g
    INNER JOIN TeamMakerPicks pk ON pk.makerId = pMakerId AND pk.guestId = g.guestId
    SET g.team = IF(pk.seat = 0, pColor0, pColor1)
    WHERE g.matchId = vMatchId;

    CALL AssertTeamsComplete(vMatchId);

    UPDATE Matches SET state = 'R' WHERE matchId = vMatchId;

    UPDATE TeamMakers
    SET state = 'F', coinWinner = pCoinWinner, finishedAt = NOW()
    WHERE makerId = pMakerId;

    COMMIT;

    SELECT
        matchId, tournamentId, tournamentName, winnerTeam, goalsDiference,
        place, playedAt, isDerby, state, players, guests
    FROM vMatchDetail
    WHERE matchId = vMatchId;
END //
DELIMITER ;

-- -----------------------------------------------------------------------------
-- CancelTeamMaker — el admin corta el armado: el partido queda en preparacion
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS CancelTeamMaker;

DELIMITER //
CREATE PROCEDURE CancelTeamMaker(
    pMakerId INT
)
BEGIN
    DECLARE vMatchId INT;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    CALL AssertTeamMakerInState(pMakerId, 'WKV');

    SELECT matchId INTO vMatchId FROM TeamMakers WHERE makerId = pMakerId;

    START TRANSACTION;
    UPDATE TeamMakers SET state = 'C', finishedAt = NOW() WHERE makerId = pMakerId;
    UPDATE MatchPlayers SET team = NULL WHERE matchId = vMatchId;
    UPDATE MatchGuests  SET team = NULL WHERE matchId = vMatchId;
    COMMIT;

    SELECT
        matchId, tournamentId, tournamentName, winnerTeam, goalsDiference,
        place, playedAt, isDerby, state, players, guests
    FROM vMatchDetail
    WHERE matchId = vMatchId;
END //
DELIMITER ;

-- -----------------------------------------------------------------------------
-- RestartTeamMaker — empezar de cero con un link nuevo
-- -----------------------------------------------------------------------------
-- Libera los dos lugares, borra elecciones y votos, y cambia el codigo: el
-- link anterior deja de valer.
DROP PROCEDURE IF EXISTS RestartTeamMaker;

DELIMITER //
CREATE PROCEDURE RestartTeamMaker(
    pMakerId     INT,
    pCaptainCode CHAR(22)
)
BEGIN
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    CALL AssertTeamMakerInState(pMakerId, 'WKV');

    START TRANSACTION;
    DELETE FROM TeamMakerPicks WHERE makerId = pMakerId;
    UPDATE TeamMakerSeats SET playerId = NULL, tokenHash = NULL, vote = NULL WHERE makerId = pMakerId;
    UPDATE TeamMakers
    SET state = 'W', captainCode = pCaptainCode, firstSeat = NULL, firstByDraw = FALSE, coinWinner = NULL
    WHERE makerId = pMakerId;
    COMMIT;

    SELECT pMakerId AS makerId, pCaptainCode AS captainCode, 'W' AS state;
END //
DELIMITER ;
