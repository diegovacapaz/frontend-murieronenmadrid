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
--
-- Los dos result sets salen del MISMO calculo, materializado una sola vez en
-- una temporal. Leer vPlayerAchievements dos veces costaba el doble: el filtro
-- por jugador no baja adentro de la cadena de vistas, asi que cada lectura
-- reconstruye los hechos de TODOS los jugadores desde cero. Medido: 449 ms
-- contra 234 ms.
--
-- La temporal es por conexion y el backend usa un pool, asi que se borra en los
-- dos extremos: la de arriba limpia lo que haya dejado una ejecucion cortada a
-- la mitad en esa misma conexion.
--
-- Las columnas van declaradas a mano y no con CREATE ... SELECT para que los
-- tipos que viajan al driver sean exactamente los de siempre: el contrato con
-- el repository es por nombre y por tipo. isBreakable ni siquiera pasa por
-- aca —sale del catalogo, como antes— justamente para no tocar su tinyint(1),
-- que es lo que el driver convierte a booleano.
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

    DROP TEMPORARY TABLE IF EXISTS tmpAchievementStates;

    CREATE TEMPORARY TABLE tmpAchievementStates (
        code     VARCHAR(24) NOT NULL,
        state    CHAR(1)     NOT NULL,
        progress BIGINT      NULL,
        target   BIGINT      NULL,
        PRIMARY KEY (code)
    ) ENGINE = MEMORY;

    INSERT INTO tmpAchievementStates (code, state, progress, target)
    SELECT a.code, a.state, a.progress, a.target
    FROM vPlayerAchievements a
    WHERE a.playerId = pPlayerId;

    -- ── 1. achievements ───────────────────────────────────────────────────────
    SELECT
        c.code,
        c.category,
        c.title,
        c.description,
        c.isBreakable,
        s.state,
        s.progress,
        s.target
    FROM Achievements c
    INNER JOIN tmpAchievementStates s
        ON s.code = c.code
    ORDER BY c.sortOrder;

    -- ── 2. summary ────────────────────────────────────────────────────────────
    -- Una fila por categoria mas la fila total, que viaja con category = NULL.
    -- El frontend usa la total para el boton del perfil y las otras tres para
    -- los contadores de cada grupo.
    --
    -- Los rotos NO cuentan como obtenidos: la medalla agrietada no suma.
    SELECT
        c.category,
        CAST(SUM(s.state = 'U') AS SIGNED) AS obtained,
        CAST(COUNT(*)           AS SIGNED) AS total
    FROM Achievements c
    INNER JOIN tmpAchievementStates s
        ON s.code = c.code
    GROUP BY c.category WITH ROLLUP;

    DROP TEMPORARY TABLE tmpAchievementStates;
END //
DELIMITER ;
