-- =============================================================================
-- murieron-en-madrid — stored procedures del modulo mundialito
-- =============================================================================
-- El mundialito es un torneo paralelo que no esta en ninguna tabla: se deduce
-- del historial de cada jugador. Toda la regla vive en las vistas
-- vMundialitoRuns / vMundialitoCurrent (ver views.sql); aca solo se arman los
-- result sets que consume el frontend.
--
-- Igual que en stats.sql, cada SP devuelve VARIOS result sets y el orden es
-- contrato con el repository. Si se agrega uno nuevo, va SIEMPRE al final.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- GetMundialitoBoard — la pantalla del mundialito
-- -----------------------------------------------------------------------------
-- Result sets, en orden:
--   1. medalWinners  quienes ganaron algun mundialito, ordenados y numerados
--   2. board         el mundialito vigente de cada jugador, ordenado por avance
--
-- El medallero desempata por fecha del primer titulo, igual que la vitrina de
-- torneos: entre dos jugadores con una copa, la tuvo defendiendo mas tiempo el
-- que la gano antes.
--
-- El orden del board cuenta una carrera: primero el campeon vigente, despues
-- los que siguen vivos por lo lejos que llegaron, y al final los eliminados
-- —tambien por lo lejos que llegaron, que es lo unico que les queda—.
DROP PROCEDURE IF EXISTS GetMundialitoBoard;

DELIMITER //
CREATE PROCEDURE GetMundialitoBoard()
BEGIN
    -- ── 1. medalWinners ───────────────────────────────────────────────────────
    SELECT
        CAST(ROW_NUMBER() OVER (
            ORDER BY t.titles DESC, t.firstTitleAt ASC, t.playerId ASC
        ) AS SIGNED) AS `position`,
        t.playerId,
        p.displayName,
        p.nickname,
        p.photo,
        p.state     AS playerState,
        p.isSagrado,
        p.cups,
        t.titles,
        t.firstTitleAt,
        t.lastTitleAt
    FROM vMundialitoTitles t
    INNER JOIN vPlayerDetail p ON p.playerId = t.playerId
    ORDER BY `position`;

    -- ── 2. board ──────────────────────────────────────────────────────────────
    -- Solo aparecen los jugadores con al menos un partido elegible: el
    -- mundialito es rendimiento, no un padron. Misma regla que la historica.
    SELECT
        c.playerId,
        p.displayName,
        p.nickname,
        p.photo,
        p.state     AS playerState,
        p.isSagrado,
        p.cups,
        COALESCE(t.titles, 0) AS titles,
        c.runIndex,
        c.played,
        c.groupPoints,
        c.status,
        c.phase,
        c.nextSlot,
        c.lastPlayedAt,
        c.balls
    FROM vMundialitoCurrent c
    INNER JOIN vPlayerDetail   p ON p.playerId = c.playerId
    LEFT  JOIN vMundialitoTitles t ON t.playerId = c.playerId
    ORDER BY
        CASE c.status WHEN 'CHAMPION' THEN 0 WHEN 'ALIVE' THEN 1 ELSE 2 END,
        c.played DESC,
        COALESCE(t.titles, 0) DESC,
        p.displayName;
END //
DELIMITER ;

-- -----------------------------------------------------------------------------
-- GetPlayerMundialito — el mundialito de un jugador, para su perfil
-- -----------------------------------------------------------------------------
-- Result sets, en orden:
--   1. summary               fila unica: cuantos corrio, cuantos gano, hasta donde llego
--   2. current               su mundialito vigente (0 filas si nunca jugo)
--   3. eliminationsByPhase   en que fase se muere, con las seis fases siempre presentes
--
-- Un jugador recien creado tiene que abrir su perfil igual: el summary sale en
-- cero por el LEFT JOIN, current viene vacio y las barras salen todas en cero.
DROP PROCEDURE IF EXISTS GetPlayerMundialito;

DELIMITER //
CREATE PROCEDURE GetPlayerMundialito(
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

    -- ── 1. summary ────────────────────────────────────────────────────────────
    -- runsPlayed cuenta tambien el mundialito en curso: es "cuantos corrio",
    -- no "cuantos termino". bestSlot es el puesto mas alto que alcanzo alguna
    -- vez —8 significa que jugo una final—; si ademas tiene titulos, la etiqueta
    -- la resuelve el frontend.
    SELECT
        pPlayerId                                         AS playerId,
        CAST(COALESCE(COUNT(r.matchId), 0)      AS SIGNED) AS matchesPlayed,
        CAST(COALESCE(MAX(r.runIndex), 0)       AS SIGNED) AS runsPlayed,
        CAST(COALESCE(SUM(r.outcome = 'CHAMPION'), 0) AS SIGNED) AS titles,
        CAST(COALESCE(SUM(r.outcome = 'OUT'), 0)      AS SIGNED) AS eliminations,
        CAST(COALESCE(MAX(r.slot), 0)           AS SIGNED) AS bestSlot
    FROM vMundialitoRuns r
    WHERE r.playerId = pPlayerId;

    -- ── 2. current ────────────────────────────────────────────────────────────
    SELECT
        c.playerId,
        c.runIndex,
        c.played,
        c.groupPoints,
        c.status,
        c.phase,
        c.nextSlot,
        c.lastPlayedAt,
        c.balls
    FROM vMundialitoCurrent c
    WHERE c.playerId = pPlayerId;

    -- ── 3. eliminationsByPhase ────────────────────────────────────────────────
    -- Las seis fases salen siempre, con cero si nunca se murio ahi: un grafico
    -- de barras al que le faltan categorias miente sobre la forma de los datos.
    --
    -- El cruce es por FASE y no por puesto: una eliminacion en grupos puede caer
    -- en el segundo partido (dos derrotas y ya no llega a los 4 puntos) o en el
    -- tercero. El slot del catalogo es solo el orden de las barras.
    WITH phases (slot, phase) AS (
        SELECT 3, 'GROUP' UNION ALL
        SELECT 4, 'R16'   UNION ALL
        SELECT 5, 'R8'    UNION ALL
        SELECT 6, 'R4'    UNION ALL
        SELECT 7, 'SF'    UNION ALL
        SELECT 8, 'F'
    )
    SELECT
        ph.slot,
        ph.phase,
        CAST(COUNT(r.matchId) AS SIGNED) AS eliminations
    FROM phases ph
    LEFT JOIN vMundialitoRuns r
      ON r.playerId = pPlayerId
     AND r.outcome  = 'OUT'
     AND r.phase    = ph.phase
    GROUP BY ph.slot, ph.phase
    ORDER BY ph.slot;
END //
DELIMITER ;
