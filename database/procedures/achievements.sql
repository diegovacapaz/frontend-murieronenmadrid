-- =============================================================================
-- murieron-en-madrid — stored procedures del modulo logros
-- =============================================================================
-- Ningun logro se guarda: el estado sale de vPlayerAchievements, que lo deduce
-- del historial. Este SP solo junta ese estado con los textos del catalogo y
-- arma los dos result sets que consume el frontend.
--
-- Igual que en los demas modulos, el orden de los result sets es contrato con
-- el repository. Si se agrega uno nuevo, va SIEMPRE al final.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- GetPlayerAchievements — la solapa de logros de un jugador
-- -----------------------------------------------------------------------------
-- Result sets, en orden:
--   1. achievements  los 28 con su catalogo y su estado, en orden de grilla
--   2. summary       cuantos lleva sobre el total, global y por categoria
--
-- El INNER JOIN va contra el catalogo y no al reves a proposito: si algun dia
-- se agrega una fila a Achievements sin su rama en la vista, ese logro no
-- aparece, en vez de aparecer con un estado inventado.
DROP PROCEDURE IF EXISTS GetPlayerAchievements;

DELIMITER //
CREATE PROCEDURE GetPlayerAchievements(
    pPlayerId INT
)
BEGIN
    IF (pPlayerId IS NULL) OR (pPlayerId < 1) THEN
        SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 46000,
            MESSAGE_TEXT = 'Identificador de jugador invalido';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM Players WHERE playerId = pPlayerId) THEN
        SIGNAL SQLSTATE '45001' SET MYSQL_ERRNO = 46100,
            MESSAGE_TEXT = 'El jugador no existe';
    END IF;

    -- ── 1. achievements ───────────────────────────────────────────────────────
    SELECT
        c.code,
        c.category,
        c.title,
        c.description,
        c.isBreakable,
        a.state,
        a.progress,
        a.target
    FROM Achievements c
    INNER JOIN vPlayerAchievements a
        ON a.code     = c.code
       AND a.playerId = pPlayerId
    ORDER BY c.sortOrder;

    -- ── 2. summary ────────────────────────────────────────────────────────────
    -- Una fila por categoria mas la fila total, que viaja con category = NULL.
    -- El frontend usa la total para el boton del perfil y las otras tres para
    -- los contadores de cada grupo.
    --
    -- Los rotos NO cuentan como obtenidos: la medalla agrietada no suma.
    SELECT
        c.category,
        CAST(SUM(a.state = 'U') AS SIGNED) AS obtained,
        CAST(COUNT(*)           AS SIGNED) AS total
    FROM Achievements c
    INNER JOIN vPlayerAchievements a
        ON a.code     = c.code
       AND a.playerId = pPlayerId
    GROUP BY c.category WITH ROLLUP;
END //
DELIMITER ;
