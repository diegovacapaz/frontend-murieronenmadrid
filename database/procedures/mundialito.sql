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
--   3. summary       los numeros del mundialito: cuantas corridas, cuantas copas
--   4. performance   rendimiento historico por jugador, ordenado por merito
--   5. eliminations  en que fase se muere el grupo entero
--   6. records       los destacados: mundialito perfecto y eterno candidato
--
-- El medallero desempata en este orden: titulos, subcampeonatos, semifinales y
-- antiguedad del primer titulo. Es la escalera natural del torneo —cuantas
-- veces lo ganaste, cuantas te quedaste en la puerta, cuantas llegaste entre
-- los cuatro— y recien cuando todo eso empata manda quien lo consiguio antes,
-- igual que en la vitrina de torneos.
--
-- Subcampeonatos = finales jugadas menos ganadas. La final se gana ganando o
-- empatando, asi que toda final que no termino en copa fue una derrota.
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
            ORDER BY t.titles DESC,
                     (s.finals - s.titles) DESC,
                     s.semis DESC,
                     t.firstTitleAt ASC,
                     t.playerId ASC
        ) AS SIGNED) AS `position`,
        t.playerId,
        p.displayName,
        p.nickname,
        p.photo,
        p.state     AS playerState,
        p.isSagrado,
        p.cups,
        t.titles,
        CAST(s.finals - s.titles AS SIGNED) AS runnerUps,
        s.semis,
        t.firstTitleAt,
        t.lastTitleAt
    FROM vMundialitoTitles t
    INNER JOIN vPlayerDetail        p ON p.playerId = t.playerId
    INNER JOIN vMundialitoPlayerStats s ON s.playerId = t.playerId
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

    -- ── 3. summary ────────────────────────────────────────────────────────────
    -- Los numeros del torneo entero. La tasa de coronacion es el dato que pone
    -- todo en perspectiva: ganar un mundialito es raro.
    SELECT
        CAST(COUNT(*)                        AS SIGNED) AS runsEnded,
        CAST(SUM(e.outcome = 'CHAMPION')     AS SIGNED) AS titles,
        SUM(e.outcome = 'CHAMPION') / COUNT(*)          AS coronationRate,
        CAST(SUM(e.qualified)                AS SIGNED) AS qualified,
        SUM(e.qualified) / COUNT(*)                     AS qualifiedRate,
        SUM(e.lastSlot)  / COUNT(*)                     AS avgRunLength,
        CAST(COUNT(DISTINCT e.playerId)      AS SIGNED) AS players,
        (SELECT CAST(COUNT(*) AS SIGNED) FROM vMundialitoCurrent WHERE status = 'ALIVE')    AS aliveNow,
        (SELECT CAST(COUNT(*) AS SIGNED) FROM vMundialitoCurrent WHERE status = 'ALIVE' AND played >= 3) AS inKnockoutNow,
        (SELECT CAST(COALESCE(SUM(perfectRuns), 0) AS SIGNED) FROM vMundialitoPlayerStats) AS perfectRuns
    FROM vMundialitoEndedRuns e;

    -- ── 4. performance ────────────────────────────────────────────────────────
    -- La tabla de la solapa. Ordena por lo conseguido y no por porcentaje: con
    -- una sola corrida clasificada, un 100% se pone arriba de todos sin haber
    -- llegado nunca a ningun lado.
    SELECT
        CAST(ROW_NUMBER() OVER (
            ORDER BY s.titles DESC, s.finals DESC, s.semis DESC,
                     COALESCE(s.qualifiedRate, 0) DESC, s.runsEnded DESC, s.playerId ASC
        ) AS SIGNED) AS `position`,
        s.playerId,
        p.displayName,
        p.nickname,
        p.photo,
        p.state     AS playerState,
        p.isSagrado,
        p.cups,
        s.runsPlayed,
        s.runsEnded,
        s.qualified,
        s.qualifiedRate,
        s.avgRunLength,
        s.koPlayed,
        s.koPassed,
        s.koRate,
        s.semis,
        s.finals,
        s.titles,
        s.bestSlot,
        s.droughtRuns
    FROM vMundialitoPlayerStats s
    INNER JOIN vPlayerDetail p ON p.playerId = s.playerId
    WHERE s.matchesPlayed > 0
    ORDER BY `position`;

    -- ── 5. eliminations ───────────────────────────────────────────────────────
    -- El cementerio del grupo. Mismo formato que el del perfil.
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
      ON r.outcome = 'OUT'
     AND r.phase   = ph.phase
    GROUP BY ph.slot, ph.phase
    ORDER BY ph.slot;

    -- ── 6. records ────────────────────────────────────────────────────────────
    -- Dos destacados con nombre y cara. Si todavia no hay nadie que califique,
    -- el result set viene vacio y la pantalla no muestra la seccion.
    (
        SELECT
            'PERFECT_RUN' AS kind,
            s.playerId,
            p.displayName,
            p.photo,
            s.perfectRuns AS value
        FROM vMundialitoPlayerStats s
        INNER JOIN vPlayerDetail p ON p.playerId = s.playerId
        WHERE s.perfectRuns > 0
        ORDER BY s.perfectRuns DESC, p.displayName
        LIMIT 1
    )
    UNION ALL
    (
        -- El que mas lejos llego sin dar nunca la vuelta.
        SELECT
            'ETERNAL_CANDIDATE' AS kind,
            s.playerId,
            p.displayName,
            p.photo,
            s.semis + s.finals AS value
        FROM vMundialitoPlayerStats s
        INNER JOIN vPlayerDetail p ON p.playerId = s.playerId
        WHERE s.titles = 0 AND (s.semis + s.finals) > 0
        ORDER BY value DESC, s.finals DESC, p.displayName
        LIMIT 1
    );
END //
DELIMITER ;

-- -----------------------------------------------------------------------------
-- GetPlayerMundialito — el mundialito de un jugador, para su perfil
-- -----------------------------------------------------------------------------
-- Result sets, en orden:
--   1. summary               fila unica: cuantos corrio, cuantos gano, como le fue
--   2. current               su mundialito vigente (0 filas si nunca jugo)
--   3. eliminationsByPhase   en que fase se muere, con las seis fases siempre presentes
--   4. highlights            verdugo y victima del mundialito (0, 1 o 2 filas)
--   5. bestRun               el mejor mundialito que corrio (0 o 1 fila)
--
-- Un jugador recien creado tiene que abrir su perfil igual: el summary sale en
-- cero por el LEFT JOIN, current viene vacio y las barras salen todas en cero.
--
-- pMinAgainst: cruces minimos contra un rival para que pueda ser verdugo o
-- victima. Viene del service (5, el mismo que usan los destacados del cara a
-- cara) y no esta clavado en el SQL.
DROP PROCEDURE IF EXISTS GetPlayerMundialito;

DELIMITER //
CREATE PROCEDURE GetPlayerMundialito(
    pPlayerId   INT,
    pMinAgainst INT
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
    --
    -- Los porcentajes (clasificacion, eliminacion directa) se calculan sobre
    -- corridas TERMINADAS: ver vMundialitoEndedRuns.
    SELECT
        s.playerId,
        s.matchesPlayed,
        s.runsPlayed,
        s.titles,
        s.eliminations,
        s.bestSlot,
        s.runsEnded,
        s.qualified,
        s.qualifiedRate,
        s.avgRunLength,
        s.koPlayed,
        s.koPassed,
        s.koRate,
        s.semis,
        s.finals,
        s.droughtRuns,
        s.perfectRuns
    FROM vMundialitoPlayerStats s
    WHERE s.playerId = pPlayerId;

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

    -- ── 4. highlights ─────────────────────────────────────────────────────────
    -- Verdugo: el que mas veces estaba enfrente cuando este jugador quedo
    -- afuera. Victima: a quien dejo afuera mas veces el.
    --
    -- El minimo de cruces es lo que evita el falso destacado: sin el, alguien
    -- que jugo dos partidos contra el y lo elimino en los dos aparece como su
    -- bestia negra con 100%. `times` es el numero crudo porque es el que se
    -- muestra ("lo dejo afuera 9 veces"); `played` acompania para que se pueda
    -- leer sobre cuantos cruces es.
    WITH crosses AS (
        SELECT other.playerId AS rivalId, CAST(COUNT(*) AS SIGNED) AS played
        FROM MatchPlayers mine
        INNER JOIN MatchPlayers other
          ON other.matchId = mine.matchId
         AND other.team   <> mine.team
        WHERE mine.playerId = pPlayerId
        GROUP BY other.playerId
    )
    (
        SELECT
            'NEMESIS' AS kind,
            k.rivalId AS playerId,
            p.displayName,
            p.photo,
            -- COUNT(*) pelado. Envuelto en CAST(... AS SIGNED) —como se hace en
            -- el resto del sistema para que los SUM no lleguen como string—,
            -- MySQL 8.4 devuelve 0 en esta rama del UNION, sin error y sin
            -- aviso. COUNT(*) ya es BIGINT y el driver lo entrega como numero.
            COUNT(*) AS times,
            c.played
        FROM vMundialitoKnockouts k
        INNER JOIN crosses       c ON c.rivalId  = k.rivalId
        INNER JOIN vPlayerDetail p ON p.playerId = k.rivalId
        WHERE k.eliminatedId = pPlayerId
          AND c.played >= pMinAgainst
        GROUP BY k.rivalId, p.displayName, p.photo, c.played
        -- COUNT(*) y no el alias `times`: adentro de un bloque parentetizado de
        -- UNION el alias no existe para el ORDER BY. Fuera de un procedure eso
        -- es un error; adentro MySQL lo acepta y ordena por cualquier cosa.
        ORDER BY COUNT(*) DESC, c.played ASC, p.displayName
        LIMIT 1
    )
    UNION ALL
    (
        SELECT
            'VICTIM' AS kind,
            k.eliminatedId AS playerId,
            p.displayName,
            p.photo,
            COUNT(*) AS times,
            c.played
        FROM vMundialitoKnockouts k
        INNER JOIN crosses       c ON c.rivalId  = k.eliminatedId
        INNER JOIN vPlayerDetail p ON p.playerId = k.eliminatedId
        WHERE k.rivalId = pPlayerId
          AND c.played >= pMinAgainst
        GROUP BY k.eliminatedId, p.displayName, p.photo, c.played
        ORDER BY COUNT(*) DESC, c.played ASC, p.displayName
        LIMIT 1
    );

    -- ── 5. bestRun ────────────────────────────────────────────────────────────
    -- El mejor mundialito que corrio: ganado antes que largo, largo antes que
    -- puntudo. Ver vMundialitoBestRun.
    SELECT
        b.playerId,
        b.runIndex,
        b.played,
        b.groupPoints,
        b.points,
        b.status,
        b.phase,
        b.nextSlot,
        b.firstPlayedAt,
        b.lastPlayedAt,
        b.balls
    FROM vMundialitoBestRun b
    WHERE b.playerId = pPlayerId;
END //
DELIMITER ;
