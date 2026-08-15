-- =============================================================================
-- murieron-en-madrid — stored procedures del modulo teams
-- =============================================================================
-- Teams es un catalogo fijo: una fila por letra de la enum, sembrada con el
-- schema. No hay alta, baja ni modificacion — solo lectura, para que el
-- frontend sepa que equipos existen y cuales son de derby sin hardcodearlos.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- SearchTeams
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS SearchTeams;

DELIMITER //
CREATE PROCEDURE SearchTeams(
    pIsDerbyTeam BOOLEAN
)
BEGIN
    SELECT team, isDerbyTeam
    FROM Teams
    WHERE (pIsDerbyTeam IS NULL OR isDerbyTeam = pIsDerbyTeam)
    ORDER BY isDerbyTeam, team;
END //
DELIMITER ;

-- -----------------------------------------------------------------------------
-- GetTeamById
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS GetTeamById;

DELIMITER //
CREATE PROCEDURE GetTeamById(
    pTeam CHAR(1)
)
BEGIN
    IF (pTeam IS NULL) OR (pTeam = '') THEN
        SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 46000,
            MESSAGE_TEXT = 'Identificador de equipo invalido';
    ELSE
        SELECT team, isDerbyTeam
        FROM Teams
        WHERE team = pTeam;
    END IF;
END //
DELIMITER ;
