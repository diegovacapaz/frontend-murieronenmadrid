-- =============================================================================
-- murieron-en-madrid — stored procedures del modulo scoreboard
-- =============================================================================
-- Las dos tablas del sistema: la de un torneo y la historica.
--
-- Llegan al frontend YA ORDENADAS y numeradas. El desempate (puntos netos ->
-- diferencia de gol -> winrate) vive en vTournamentStandings / vGeneralStandings
-- y no se reimplementa en ningun cliente: si maniana cambia el criterio, cambia
-- en la vista y todos los consumidores lo heredan.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- GetTournamentScoreboard — tabla de posiciones de un torneo
-- -----------------------------------------------------------------------------
-- Se une con vPlayerDetail para que la fila traiga ya el nombre, la foto y las
-- copas: el frontend pinta la tabla sin cruzar nada contra el listado de
-- jugadores.
DROP PROCEDURE IF EXISTS GetTournamentScoreboard;

DELIMITER //
CREATE PROCEDURE GetTournamentScoreboard(
    pTournamentId INT
)
BEGIN
    IF (pTournamentId IS NULL) OR (pTournamentId < 1) THEN
        SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 46000,
            MESSAGE_TEXT = 'Identificador de torneo invalido';
    ELSEIF NOT EXISTS (SELECT 1 FROM Tournaments WHERE tournamentId = pTournamentId) THEN
        SIGNAL SQLSTATE '45001' SET MYSQL_ERRNO = 46200,
            MESSAGE_TEXT = 'El torneo no existe';
    ELSE
        SELECT
            st.`position`,
            st.playerId,
            p.displayName,
            p.nickname,
            p.photo,
            p.state       AS playerState,
            p.isSagrado,
            p.cups,
            st.played,
            st.won,
            st.drew,
            st.lost,
            st.goalsDiference,
            st.points,
            st.maxPoints,
            st.winRate,
            st.penalty,
            st.netPoints
        FROM vTournamentStandings st
        INNER JOIN vPlayerDetail p ON p.playerId = st.playerId
        WHERE st.tournamentId = pTournamentId
        ORDER BY st.`position`;
    END IF;
END //
DELIMITER ;

-- -----------------------------------------------------------------------------
-- GetGeneralScoreboard — tabla historica
-- -----------------------------------------------------------------------------
-- Suma todos los torneos. Un jugador sin partidos no aparece: la tabla es de
-- rendimiento, no un padron.
DROP PROCEDURE IF EXISTS GetGeneralScoreboard;

DELIMITER //
CREATE PROCEDURE GetGeneralScoreboard()
BEGIN
    SELECT
        g.`position`,
        g.playerId,
        p.displayName,
        p.nickname,
        p.photo,
        p.state       AS playerState,
        p.isSagrado,
        p.cups,
        p.championships,
        g.tournamentsPlayed,
        g.played,
        g.won,
        g.drew,
        g.lost,
        g.goalsDiference,
        g.points,
        g.maxPoints,
        g.winRate,
        g.penalty,
        g.netPoints
    FROM vGeneralStandings g
    INNER JOIN vPlayerDetail p ON p.playerId = g.playerId
    ORDER BY g.`position`;
END //
DELIMITER ;
