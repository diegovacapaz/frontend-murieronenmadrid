-- =============================================================================
-- murieron-en-madrid — stored procedures del modulo stats
-- =============================================================================
-- Todo lo que el frontend grafica sale de aca, ya calculado. Ningun cliente
-- deriva metricas: pide, pinta.
--
-- Cada SP devuelve VARIOS result sets. El orden es contrato — el repository lo
-- desestructura con callMulti y esta documentado en su interface. Si se agrega
-- uno nuevo, va SIEMPRE al final.
--
-- Se usan CTEs y no tablas temporales por una limitacion concreta de MySQL: una
-- tabla temporal no se puede referenciar dos veces en la misma consulta
-- ("Can't reopen table"), y estos calculos necesitan cruzar el mismo agregado
-- consigo mismo. Un CTE si se puede referenciar N veces.
--
-- Los CAST AS DOUBLE tampoco son cosmeticos: una division entre enteros da
-- DECIMAL en MySQL, y el driver entrega los DECIMAL como string.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- GetPlayerStats — todo el perfil de un jugador
-- -----------------------------------------------------------------------------
-- Result sets, en orden:
--   1. summary          fila unica: totales historicos, posicion, copas, debut
--   2. perTournament    su rendimiento torneo por torneo, con posicion
--   3. winRateSeries    evolucion del winrate partido a partido (acumulado)
--   4. rivals           cara a cara contra cada rival
--   5. partners         rendimiento junto a cada companiero
--   6. highlights       victima / verdugo / clasico / mejor y peor quimica
--   7. teamDistribution cuanto jugo en cada equipo y como le fue
--   8. streaks          rachas: la actual, la mejor invicta, la peor sequia
--   9. activity         todos los partidos del grupo, con si jugo o falto
--  10. relegationRuns   cada carrera al descenso, completa o no
--  11. relegationMatches  los partidos de cada carrera, para dibujar el camino
--
-- pMinAgainst / pMinTogether: minimo de cruces y de partidos juntos para que
-- un rival o un companiero entre en los destacados. Vienen del service (5 y 5,
-- como en el sistema original) en vez de estar clavados en el SQL.
DROP PROCEDURE IF EXISTS GetPlayerStats;

DELIMITER //
CREATE PROCEDURE GetPlayerStats(
    pPlayerId     INT,
    pMinAgainst   INT,
    pMinTogether  INT
)
BEGIN
    DECLARE vDebutTournamentId   INT;
    DECLARE vDebutTournamentName VARCHAR(40);

    IF (pPlayerId IS NULL) OR (pPlayerId < 1) THEN
        SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 46000,
            MESSAGE_TEXT = 'Identificador de jugador invalido';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM Players WHERE playerId = pPlayerId) THEN
        SIGNAL SQLSTATE '45001' SET MYSQL_ERRNO = 46100,
            MESSAGE_TEXT = 'El jugador no existe';
    END IF;

    -- Debut = el torneo de su primer partido. No es un dato editable: se deduce.
    SELECT r.tournamentId, t.`name`
      INTO vDebutTournamentId, vDebutTournamentName
    FROM vMatchPlayerResults r
    INNER JOIN Tournaments t ON t.tournamentId = r.tournamentId
    WHERE r.playerId = pPlayerId
    ORDER BY r.playedAt, r.matchId
    LIMIT 1;

    -- ── 1. summary ────────────────────────────────────────────────────────────
    -- LEFT JOIN contra la tabla historica: un jugador recien creado no tiene
    -- fila ahi y su perfil tiene que abrir igual, en cero.
    SELECT
        p.playerId,
        p.displayName,
        p.firstName,
        p.secondName,
        p.nickname,
        p.photo,
        p.state,
        p.isSagrado,
        p.createdAt,
        p.cups,
        p.championships,
        g.`position`,
        COALESCE(g.tournamentsPlayed, 0) AS tournamentsPlayed,
        COALESCE(g.played, 0)            AS played,
        COALESCE(g.won, 0)               AS won,
        COALESCE(g.drew, 0)              AS drew,
        COALESCE(g.lost, 0)              AS lost,
        COALESCE(g.goalsDiference, 0)    AS goalsDiference,
        COALESCE(g.points, 0)            AS points,
        COALESCE(g.maxPoints, 0)         AS maxPoints,
        g.winRate,
        COALESCE(g.penalty, 0)           AS penalty,
        COALESCE(g.netPoints, 0)         AS netPoints,
        -- Va en el summary y no en el result set de descensos porque la
        -- insignia del encabezado se dibuja antes de que exista ninguna
        -- carrera: el que nunca bajo tiene que llegar con un cero, no con una
        -- lista vacia que el frontend tenga que interpretar.
        COALESCE(rel.relegations, 0)     AS relegations,
        vDebutTournamentId               AS debutTournamentId,
        vDebutTournamentName             AS debutTournamentName
    FROM vPlayerDetail p
    LEFT JOIN vGeneralStandings g  ON g.playerId   = p.playerId
    LEFT JOIN vPlayerRelegations rel ON rel.playerId = p.playerId
    WHERE p.playerId = pPlayerId;

    -- ── 2. perTournament ──────────────────────────────────────────────────────
    SELECT
        st.tournamentId,
        t.`name`      AS tournamentName,
        t.state       AS tournamentState,
        t.wasTracked,
        t.startedAt,
        st.`position`,
        st.played,
        st.won,
        st.drew,
        st.lost,
        st.goalsDiference,
        st.points,
        st.maxPoints,
        st.winRate,
        st.penalty,
        st.netPoints,
        (t.state = 'F' AND st.`position` = 1) AS isChampion
    FROM vTournamentStandings st
    INNER JOIN Tournaments t ON t.tournamentId = st.tournamentId
    WHERE st.playerId = pPlayerId
    ORDER BY t.startedAt, t.tournamentId;

    -- ── 3. winRateSeries ──────────────────────────────────────────────────────
    -- Winrate acumulado: puntos logrados sobre puntos posibles hasta ese
    -- partido. Cada partido se puntua con la tabla de SU torneo, por eso el
    -- join: una victoria de la Apertura y una de la Clausura no valen igual.
    SELECT
        CAST(ROW_NUMBER() OVER w AS SIGNED) AS matchNumber,
        r.matchId,
        r.tournamentId,
        t.`name` AS tournamentName,
        r.playedAt,
        r.result,
        r.goalsDiference,
        CAST(
            SUM(CASE r.result
                    WHEN 'W' THEN t.winningPoints
                    WHEN 'D' THEN t.drawingPoints
                    ELSE t.lossingPoints
                END) OVER w
            / SUM(t.winningPoints) OVER w
        AS DOUBLE) AS winRate
    FROM vMatchPlayerResults r
    INNER JOIN Tournaments t ON t.tournamentId = r.tournamentId
    WHERE r.playerId = pPlayerId
    WINDOW w AS (ORDER BY r.playedAt, r.matchId
                 ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
    ORDER BY r.playedAt, r.matchId;

    -- ── 4. rivals ─────────────────────────────────────────────────────────────
    -- El saldo (won - lost) es lo que define victima y verdugo, no la cantidad
    -- bruta de victorias: ganarle 8 de 20 no es dominarlo.
    WITH mine AS (
        SELECT r.matchId, r.team, r.result
        FROM vMatchPlayerResults r
        WHERE r.playerId = pPlayerId
    ),
    rivals AS (
        SELECT
            o.playerId,
            CAST(COUNT(*)                                       AS SIGNED) AS played,
            CAST(SUM(m.result = 'W')                            AS SIGNED) AS won,
            CAST(SUM(m.result = 'D')                            AS SIGNED) AS drew,
            CAST(SUM(m.result = 'L')                            AS SIGNED) AS lost,
            CAST(SUM(m.result = 'W') - SUM(m.result = 'L')      AS SIGNED) AS balance,
            CAST(SUM(m.result = 'W') AS DOUBLE) / COUNT(*) AS winRate
        FROM mine m
        INNER JOIN vMatchPlayerResults o
            ON o.matchId = m.matchId AND o.team <> m.team
        GROUP BY o.playerId
    )
    SELECT
        r.playerId, p.displayName, p.photo,
        r.played, r.won, r.drew, r.lost, r.balance, r.winRate
    FROM rivals r
    INNER JOIN vPlayerDetail p ON p.playerId = r.playerId
    ORDER BY r.played DESC, r.balance DESC, p.displayName;

    -- ── 5. partners ───────────────────────────────────────────────────────────
    WITH mine AS (
        SELECT r.matchId, r.team, r.result
        FROM vMatchPlayerResults r
        WHERE r.playerId = pPlayerId
    ),
    partners AS (
        SELECT
            o.playerId,
            CAST(COUNT(*)                       AS SIGNED) AS played,
            CAST(SUM(m.result = 'W')            AS SIGNED) AS won,
            CAST(SUM(m.result = 'D')            AS SIGNED) AS drew,
            CAST(SUM(m.result = 'L')            AS SIGNED) AS lost,
            CAST(SUM(m.result = 'W') AS DOUBLE) / COUNT(*) AS winRate
        FROM mine m
        INNER JOIN vMatchPlayerResults o
            ON o.matchId = m.matchId AND o.team = m.team AND o.playerId <> pPlayerId
        GROUP BY o.playerId
    )
    SELECT
        pa.playerId, p.displayName, p.photo,
        pa.played, pa.won, pa.drew, pa.lost, pa.winRate
    FROM partners pa
    INNER JOIN vPlayerDetail p ON p.playerId = pa.playerId
    ORDER BY pa.winRate DESC, pa.played DESC, p.displayName;

    -- ── 6. highlights ─────────────────────────────────────────────────────────
    -- Los cinco destacados del perfil, resueltos en SQL con las mismas reglas
    -- que tenia el sistema original:
    --   · victima / verdugo: mejor y peor saldo, con minimo de cruces;
    --   · clasico: el rival mas repetido;
    --   · quimica: el umbral de partidos juntos solo se aplica si al menos 4
    --     companieros lo superan (con poca muestra, filtrar deja el cuadro
    --     vacio); y se toman como maximo floor(n/2) por punta, para que un
    --     mismo duo no salga a la vez como mejor y peor quimica.
    WITH mine AS (
        SELECT r.matchId, r.team, r.result
        FROM vMatchPlayerResults r
        WHERE r.playerId = pPlayerId
    ),
    rivals AS (
        SELECT
            o.playerId,
            CAST(COUNT(*)                                  AS SIGNED) AS played,
            CAST(SUM(m.result = 'W')                       AS SIGNED) AS won,
            CAST(SUM(m.result = 'D')                       AS SIGNED) AS drew,
            CAST(SUM(m.result = 'L')                       AS SIGNED) AS lost,
            CAST(SUM(m.result = 'W') - SUM(m.result = 'L') AS SIGNED) AS balance,
            CAST(SUM(m.result = 'W') AS DOUBLE) / COUNT(*) AS winRate
        FROM mine m
        INNER JOIN vMatchPlayerResults o
            ON o.matchId = m.matchId AND o.team <> m.team
        GROUP BY o.playerId
    ),
    partners AS (
        SELECT
            o.playerId,
            CAST(COUNT(*)                       AS SIGNED) AS played,
            CAST(SUM(m.result = 'W')            AS SIGNED) AS won,
            CAST(SUM(m.result = 'D')            AS SIGNED) AS drew,
            CAST(SUM(m.result = 'L')            AS SIGNED) AS lost,
            CAST(SUM(m.result = 'W') AS DOUBLE) / COUNT(*) AS winRate
        FROM mine m
        INNER JOIN vMatchPlayerResults o
            ON o.matchId = m.matchId AND o.team = m.team AND o.playerId <> pPlayerId
        GROUP BY o.playerId
    ),
    partnersQualified AS (
        SELECT COUNT(*) AS n FROM partners WHERE played >= pMinTogether
    ),
    partnersUsable AS (
        SELECT pa.*
        FROM partners pa
        CROSS JOIN partnersQualified q
        WHERE pa.played >= IF(q.n >= 4, pMinTogether, 0)
    ),
    partnersRanked AS (
        SELECT
            u.*,
            ROW_NUMBER() OVER (ORDER BY u.winRate DESC, u.played DESC, u.playerId) AS rankBest,
            ROW_NUMBER() OVER (ORDER BY u.winRate ASC,  u.played DESC, u.playerId) AS rankWorst,
            LEAST(2, FLOOR(COUNT(*) OVER () / 2))                                  AS picks
        FROM partnersUsable u
    ),
    victim AS (
        SELECT r.*, ROW_NUMBER() OVER (ORDER BY r.balance DESC, r.played DESC, r.playerId) AS rn
        FROM rivals r
        WHERE r.balance > 0 AND r.played >= pMinAgainst
    ),
    nemesis AS (
        SELECT r.*, ROW_NUMBER() OVER (ORDER BY r.balance ASC, r.played DESC, r.playerId) AS rn
        FROM rivals r
        WHERE r.balance < 0 AND r.played >= pMinAgainst
    ),
    classic AS (
        SELECT r.*, ROW_NUMBER() OVER (ORDER BY r.played DESC, r.balance DESC, r.playerId) AS rn
        FROM rivals r
    )
    SELECT 'VICTIM' AS kind, v.playerId, p.displayName, p.photo,
           v.played, v.won, v.drew, v.lost, v.balance, v.winRate
    FROM victim v INNER JOIN vPlayerDetail p ON p.playerId = v.playerId
    WHERE v.rn = 1

    UNION ALL

    SELECT 'NEMESIS', n.playerId, p.displayName, p.photo,
           n.played, n.won, n.drew, n.lost, n.balance, n.winRate
    FROM nemesis n INNER JOIN vPlayerDetail p ON p.playerId = n.playerId
    WHERE n.rn = 1

    UNION ALL

    SELECT 'CLASSIC', c.playerId, p.displayName, p.photo,
           c.played, c.won, c.drew, c.lost, c.balance, c.winRate
    FROM classic c INNER JOIN vPlayerDetail p ON p.playerId = c.playerId
    WHERE c.rn = 1

    UNION ALL

    SELECT 'BEST_CHEMISTRY', b.playerId, p.displayName, p.photo,
           b.played, b.won, b.drew, b.lost, NULL, b.winRate
    FROM partnersRanked b INNER JOIN vPlayerDetail p ON p.playerId = b.playerId
    WHERE b.rankBest <= b.picks

    UNION ALL

    SELECT 'WORST_CHEMISTRY', w.playerId, p.displayName, p.photo,
           w.played, w.won, w.drew, w.lost, NULL, w.winRate
    FROM partnersRanked w INNER JOIN vPlayerDetail p ON p.playerId = w.playerId
    WHERE w.rankWorst <= w.picks;

    -- ── 7. teamDistribution ───────────────────────────────────────────────────
    SELECT
        r.team,
        t.isDerbyTeam,
        CAST(COUNT(*)                       AS SIGNED) AS played,
        CAST(SUM(r.result = 'W')            AS SIGNED) AS won,
        CAST(SUM(r.result = 'D')            AS SIGNED) AS drew,
        CAST(SUM(r.result = 'L')            AS SIGNED) AS lost,
        CAST(SUM(r.result = 'W') AS DOUBLE) / COUNT(*) AS winRate
    FROM vMatchPlayerResults r
    INNER JOIN Teams t ON t.team = r.team
    WHERE r.playerId = pPlayerId
    GROUP BY r.team, t.isDerbyTeam
    ORDER BY played DESC;

    -- ── 8. streaks ────────────────────────────────────────────────────────────
    -- Una fila siempre, aunque nunca haya jugado: vPlayerStreaks parte de
    -- Players y devuelve ceros.
    SELECT
        s.playerId,
        s.bestUnbeaten,
        s.bestUnbeatenEndedAt,
        s.bestWin,
        s.bestWinEndedAt,
        s.worstWinless,
        s.currentUnbeaten,
        s.currentWinless
    FROM vPlayerStreaks s
    WHERE s.playerId = pPlayerId;

    -- ── 9. activity ───────────────────────────────────────────────────────────
    -- TODOS los partidos de la historia, jugados o no, para la grilla de
    -- presentismo. `result` en NULL es una ausencia.
    --
    -- Son los partidos del grupo y no los del jugador a proposito: la grilla
    -- tiene que mostrar los huecos, que es justamente el dato. Un partido
    -- anterior a su debut tambien cuenta como hueco, y esta bien —muestra desde
    -- cuando esta—.
    SELECT
        m.matchId,
        m.tournamentId,
        t.`name` AS tournamentName,
        m.playedAt,
        r.result,
        r.team
    FROM Matches m
    INNER JOIN Tournaments t ON t.tournamentId = m.tournamentId
    LEFT JOIN vMatchPlayerResults r
      ON r.matchId  = m.matchId
     AND r.playerId = pPlayerId
    ORDER BY m.playedAt, m.matchId;

    -- ── 10. relegationRuns ────────────────────────────────────────────────────
    -- Cada carrera al descenso del jugador, en orden cronologico. Vienen TODAS,
    -- tambien las que se salvaron con dos partidos: es el frontend el que
    -- decide cual mostrar segun el caso —los descensos consumados, la que esta
    -- en curso, o la mas cerca que estuvo el que nunca bajo— y para eso las
    -- necesita a mano. Son pocas filas por jugador.
    SELECT
        r.runIndex,
        r.matches,
        r.losses,
        r.draws,
        r.startedAt,
        r.endedAt,
        r.isRelegated,
        r.isAllLosses,
        r.isOpen
    FROM vPlayerRelegationRuns r
    WHERE r.playerId = pPlayerId
    ORDER BY r.runIndex;

    -- ── 11. relegationMatches ─────────────────────────────────────────────────
    -- Los partidos de cada carrera, para dibujar el camino paso a paso. Se
    -- correlacionan con el result set anterior por runIndex.
    --
    -- Los empates estan y cuentan igual que las derrotas: la unica diferencia
    -- que sobrevive es el color con que el perfil los pinta. posInRace es la
    -- casilla, de 1 a 8, y es lo unico que define el orden del dibujo.
    SELECT
        r.runIndex,
        m.matchId,
        m.tournamentId,
        t.`name` AS tournamentName,
        m.playedAt,
        m.result,
        m.goalsDiference,
        m.team,
        m.posInRace
    FROM vPlayerWinlessRunMatches m
    INNER JOIN vPlayerRelegationRuns r
        ON r.playerId = m.playerId
       AND r.runId    = m.runId
       AND r.raceNo   = m.raceNo
    INNER JOIN Tournaments t ON t.tournamentId = m.tournamentId
    WHERE m.playerId = pPlayerId
    ORDER BY r.runIndex, m.playedAt, m.matchId;
END //
DELIMITER ;

-- -----------------------------------------------------------------------------
-- GetTournamentStats — el pulso de un torneo
-- -----------------------------------------------------------------------------
-- Result sets, en orden:
--   1. summary        fila unica con los totales del torneo
--   2. teamPerformance  como le fue a cada equipo
--   3. headToHead     cruce equipo vs equipo, separando derbies de partidos normales
--   4. matchesByPlace donde se jugo
--   5. timeline       partido a partido, para la linea de tiempo
--   6. race           puntos acumulados fecha a fecha, todos los jugadores
--   7. attendance     quien jugo cada fecha, para el mapa de asistencia
DROP PROCEDURE IF EXISTS GetTournamentStats;

DELIMITER //
CREATE PROCEDURE GetTournamentStats(
    pTournamentId INT
)
BEGIN
    IF (pTournamentId IS NULL) OR (pTournamentId < 1) THEN
        SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 46000,
            MESSAGE_TEXT = 'Identificador de torneo invalido';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM Tournaments WHERE tournamentId = pTournamentId) THEN
        SIGNAL SQLSTATE '45001' SET MYSQL_ERRNO = 46200,
            MESSAGE_TEXT = 'El torneo no existe';
    END IF;

    -- ── 1. summary ────────────────────────────────────────────────────────────
    SELECT
        t.tournamentId,
        t.`name`   AS tournamentName,
        t.state,
        t.wasTracked,
        t.startedAt,
        t.endedAt,
        CAST(COALESCE(m.matches, 0)   AS SIGNED) AS matches,
        CAST(COALESCE(m.derbies, 0)   AS SIGNED) AS derbies,
        CAST(COALESCE(m.draws, 0)     AS SIGNED) AS draws,
        CAST(COALESCE(mp.players, 0)  AS SIGNED) AS players,
        CAST(COALESCE(m.totalGoals, 0) AS SIGNED) AS totalGoalsDiference,
        CAST(m.avgGoals   AS DOUBLE)  AS avgGoalsDiference,
        CAST(mp.avgSquad  AS DOUBLE)  AS avgPlayersPerMatch,
        m.firstMatchAt,
        m.lastMatchAt,
        ch.playerId    AS championPlayerId,
        cp.displayName AS championName
    FROM Tournaments t
    LEFT JOIN (
        SELECT
            tournamentId,
            COUNT(*)                    AS matches,
            SUM(isDerby = 1)            AS derbies,
            SUM(winnerTeam IS NULL)     AS draws,
            SUM(goalsDiference)         AS totalGoals,
            AVG(goalsDiference)         AS avgGoals,
            MIN(playedAt)               AS firstMatchAt,
            MAX(playedAt)               AS lastMatchAt
        FROM Matches
        WHERE tournamentId = pTournamentId
        GROUP BY tournamentId
    ) m ON m.tournamentId = t.tournamentId
    LEFT JOIN (
        SELECT
            tournamentId,
            COUNT(DISTINCT playerId)                      AS players,
            COUNT(*) / NULLIF(COUNT(DISTINCT matchId), 0) AS avgSquad
        FROM MatchPlayers
        WHERE tournamentId = pTournamentId
        GROUP BY tournamentId
    ) mp ON mp.tournamentId = t.tournamentId
    LEFT JOIN vTournamentChampions ch ON ch.tournamentId = t.tournamentId
    LEFT JOIN vPlayerDetail cp        ON cp.playerId     = ch.playerId
    WHERE t.tournamentId = pTournamentId;

    -- ── 2. teamPerformance ────────────────────────────────────────────────────
    -- Un equipo "jugo" un partido si tuvo al menos un convocado en el. El
    -- DISTINCT es lo que evita contar el partido una vez por jugador.
    WITH teamMatches AS (
        SELECT DISTINCT mp.matchId, mp.team, m.winnerTeam, m.isDerby, m.goalsDiference
        FROM MatchPlayers mp
        INNER JOIN Matches m ON m.matchId = mp.matchId
        WHERE mp.tournamentId = pTournamentId
    )
    SELECT
        tm.team,
        t.isDerbyTeam,
        CAST(COUNT(*)                                            AS SIGNED) AS played,
        CAST(SUM(tm.winnerTeam = tm.team)                        AS SIGNED) AS won,
        CAST(SUM(tm.winnerTeam IS NULL)                          AS SIGNED) AS drew,
        CAST(SUM(tm.winnerTeam IS NOT NULL
                 AND tm.winnerTeam <> tm.team)                   AS SIGNED) AS lost,
        CAST(SUM(tm.winnerTeam = tm.team) AS DOUBLE) / COUNT(*) AS winRate,
        CAST(SUM(CASE WHEN tm.winnerTeam = tm.team THEN tm.goalsDiference
                      WHEN tm.winnerTeam IS NULL   THEN 0
                      ELSE -tm.goalsDiference END)               AS SIGNED) AS goalsDiference
    FROM teamMatches tm
    INNER JOIN Teams t ON t.team = tm.team
    GROUP BY tm.team, t.isDerbyTeam
    ORDER BY t.isDerbyTeam, tm.team;

    -- ── 3. headToHead ─────────────────────────────────────────────────────────
    -- El cruce real: quien le gana a quien. Separado por isDerby, como pide el
    -- requerimiento — Sagrado vs Resto del Mundo no se mezcla con Dark vs Light.
    WITH teamsInMatch AS (
        SELECT DISTINCT matchId, team
        FROM MatchPlayers
        WHERE tournamentId = pTournamentId
    ),
    pairs AS (
        SELECT a.matchId, a.team AS teamA, b.team AS teamB
        FROM teamsInMatch a
        INNER JOIN teamsInMatch b ON b.matchId = a.matchId AND b.team > a.team
    )
    SELECT
        pr.teamA,
        pr.teamB,
        m.isDerby,
        CAST(COUNT(*)                            AS SIGNED) AS matches,
        CAST(SUM(m.winnerTeam = pr.teamA)        AS SIGNED) AS winsA,
        CAST(SUM(m.winnerTeam = pr.teamB)        AS SIGNED) AS winsB,
        CAST(SUM(m.winnerTeam IS NULL)           AS SIGNED) AS draws,
        CAST(SUM(m.winnerTeam = pr.teamA) AS DOUBLE) / COUNT(*) AS winRateA,
        CAST(SUM(m.winnerTeam = pr.teamB) AS DOUBLE) / COUNT(*) AS winRateB,
        CAST(AVG(m.goalsDiference)               AS DOUBLE) AS avgGoalsDiference
    FROM pairs pr
    INNER JOIN Matches m ON m.matchId = pr.matchId
    GROUP BY pr.teamA, pr.teamB, m.isDerby
    ORDER BY m.isDerby, pr.teamA, pr.teamB;

    -- ── 4. matchesByPlace ─────────────────────────────────────────────────────
    SELECT
        place,
        CAST(COUNT(*)                 AS SIGNED) AS matches,
        CAST(AVG(goalsDiference)      AS DOUBLE) AS avgGoalsDiference
    FROM Matches
    WHERE tournamentId = pTournamentId
    GROUP BY place
    ORDER BY matches DESC, place;

    -- ── 5. timeline ───────────────────────────────────────────────────────────
    SELECT
        m.matchId,
        m.playedAt,
        m.place,
        m.winnerTeam,
        m.goalsDiference,
        m.isDerby,
        CAST(COUNT(mp.playerId) AS SIGNED) AS squadSize
    FROM Matches m
    LEFT JOIN MatchPlayers mp ON mp.matchId = m.matchId
    WHERE m.tournamentId = pTournamentId
    GROUP BY m.matchId, m.playedAt, m.place, m.winnerTeam, m.goalsDiference, m.isDerby
    ORDER BY m.playedAt, m.matchId;

    -- ── 6. race ───────────────────────────────────────────────────────────────
    -- La carrera del campeonato: puntos acumulados fecha a fecha, de TODOS.
    --
    -- Una fila por jugador con su serie como JSON, y no una fila por (jugador,
    -- fecha): son veintisiete por veinticuatro, y mandar 648 filas con ocho
    -- columnas cada una para dibujar veintisiete lineas es pagar el ancho de
    -- banda de una tabla para alimentar un grafico.
    --
    -- La grilla completa (cada jugador contra CADA partido) es lo que hace que
    -- la linea siga siendo horizontal cuando alguien falta, en vez de saltar
    -- directo al proximo partido que jugo y mentir sobre cuando sumo.
    --
    -- `highlight` marca las cuatro que van en color: los cuatro primeros de la
    -- tabla tal como esta hoy. En un torneo en curso son los que van punteando;
    -- en uno terminado, los del podio ampliado.
    --
    -- Que solo cuatro tengan color no deja a nadie afuera: las otras veintitres
    -- lineas se dibujan igual, en gris. `everLed` viaja para que el frontend
    -- pueda señalar a alguien que lidero y despues se cayo de los cuatro.
    WITH tourMatches AS (
        SELECT
            m.matchId,
            m.playedAt,
            CAST(ROW_NUMBER() OVER (ORDER BY m.playedAt, m.matchId) AS SIGNED) AS n
        FROM Matches m
        WHERE m.tournamentId = pTournamentId
    ),
    squad AS (
        SELECT DISTINCT mp.playerId
        FROM MatchPlayers mp
        WHERE mp.tournamentId = pTournamentId
    ),
    grid AS (
        SELECT
            sq.playerId,
            tm.n,
            tm.matchId,
            tm.playedAt,
            r.result,
            COALESCE(
                CASE r.result
                    WHEN 'W' THEN t.winningPoints
                    WHEN 'D' THEN t.drawingPoints
                    WHEN 'L' THEN t.lossingPoints
                END, 0) AS points
        FROM squad sq
        CROSS JOIN tourMatches tm
        INNER JOIN Tournaments t ON t.tournamentId = pTournamentId
        LEFT JOIN vMatchPlayerResults r
          ON r.playerId = sq.playerId
         AND r.matchId  = tm.matchId
    ),
    cumulative AS (
        SELECT
            g.*,
            SUM(g.points) OVER (PARTITION BY g.playerId ORDER BY g.n) AS acc
        FROM grid g
    ),
    ranked AS (
        -- RANK y no ROW_NUMBER: si tres empatan en la punta, los tres lideran.
        SELECT c.*, RANK() OVER (PARTITION BY c.n ORDER BY c.acc DESC) AS posAt
        FROM cumulative c
    ),
    ledEver AS (
        SELECT playerId, CAST(MIN(n) AS SIGNED) AS firstLedAt
        FROM ranked
        WHERE posAt = 1
        GROUP BY playerId
    ),
    priority AS (
        SELECT
            st.playerId,
            st.`position`,
            led.firstLedAt
        FROM vTournamentStandings st
        LEFT JOIN ledEver led ON led.playerId = st.playerId
        WHERE st.tournamentId = pTournamentId
    )
    SELECT
        pr.playerId,
        p.displayName,
        pr.`position`,
        CAST(pr.`position` <= 4 AS SIGNED)           AS highlight,
        CAST(pr.firstLedAt IS NOT NULL AS SIGNED)  AS everLed,
        series.total,
        series.series
    FROM priority pr
    INNER JOIN vPlayerDetail p ON p.playerId = pr.playerId
    INNER JOIN (
        SELECT
            ordered.playerId,
            MAX(ordered.acc) AS total,
            JSON_ARRAYAGG(
                JSON_OBJECT('n', ordered.n, 'p', ordered.acc, 'r', ordered.result)
            ) AS series
        FROM (
            SELECT r.playerId, r.n, r.acc, r.result
            FROM ranked r
            ORDER BY r.playerId, r.n
        ) ordered
        GROUP BY ordered.playerId
    ) series ON series.playerId = pr.playerId
    ORDER BY pr.`position`;

    -- ── 7. attendance ─────────────────────────────────────────────────────────
    -- Quien estuvo en cada fecha. Viaja como lista de matchId por jugador y no
    -- como una fila por celda: son veintisiete jugadores por veinticuatro
    -- fechas, y mandar las 648 combinaciones para decir "no vino" es pagar
    -- ancho de banda por el vacio. El frontend cruza contra el timeline.
    SELECT
        att.playerId,
        p.displayName,
        p.photo,
        att.played,
        att.matches
    FROM (
        SELECT
            ordered.playerId,
            CAST(COUNT(*) AS SIGNED) AS played,
            JSON_ARRAYAGG(ordered.matchId) AS matches
        FROM (
            SELECT mp.playerId, mp.matchId
            FROM MatchPlayers mp
            INNER JOIN Matches m ON m.matchId = mp.matchId
            WHERE m.tournamentId = pTournamentId
            ORDER BY mp.playerId, m.playedAt, m.matchId
        ) ordered
        GROUP BY ordered.playerId
    ) att
    INNER JOIN vPlayerDetail p ON p.playerId = att.playerId
    ORDER BY att.played DESC, p.displayName;
END //
DELIMITER ;

-- -----------------------------------------------------------------------------
-- GetGeneralStats — las estadisticas historicas, para acompaniar la tabla general
-- -----------------------------------------------------------------------------
-- Result sets, en orden:
--   1. summary          totales de todo el sistema
--   2. headToHead       cruce equipo vs equipo en toda la historia
--   3. championsRanking la vitrina: quien gano cuantos torneos
--   4. tournamentsTimeline  un punto por torneo, para el grafico historico
--   5. topWinRate       los mejores por winrate, con minimo de partidos
--   6. records          maximos y minimos de una sola pasada
--   7. streakRecords    las rachas invictas mas largas de la historia
--   8. winlessRecords   las rachas sin ganar mas largas, el espejo del anterior
--   9. relegations      quien descendio y cuantas veces
DROP PROCEDURE IF EXISTS GetGeneralStats;

DELIMITER //
CREATE PROCEDURE GetGeneralStats(
    pMinMatches INT
)
BEGIN
    -- ── 1. summary ────────────────────────────────────────────────────────────
    SELECT
        (SELECT CAST(COUNT(*) AS SIGNED) FROM Players)                     AS players,
        (SELECT CAST(COUNT(*) AS SIGNED) FROM Players WHERE state = 'A')   AS activePlayers,
        (SELECT CAST(COUNT(*) AS SIGNED) FROM Players WHERE isSagrado = 1) AS sagradoPlayers,
        (SELECT CAST(COUNT(*) AS SIGNED) FROM Tournaments)                 AS tournaments,
        (SELECT CAST(COUNT(*) AS SIGNED) FROM Tournaments WHERE state = 'F') AS finishedTournaments,
        (SELECT CAST(COUNT(*) AS SIGNED) FROM Matches)                     AS matches,
        (SELECT CAST(SUM(isDerby = 1) AS SIGNED) FROM Matches)             AS derbies,
        (SELECT CAST(SUM(winnerTeam IS NULL) AS SIGNED) FROM Matches)      AS draws,
        (SELECT CAST(SUM(goalsDiference) AS SIGNED) FROM Matches)          AS totalGoalsDiference,
        (SELECT CAST(AVG(goalsDiference) AS DOUBLE) FROM Matches)          AS avgGoalsDiference,
        (SELECT MIN(playedAt) FROM Matches)                                AS firstMatchAt,
        (SELECT MAX(playedAt) FROM Matches)                                AS lastMatchAt,
        (SELECT CAST(COUNT(*) AS SIGNED) FROM MatchPlayers)                AS appearances,
        (SELECT CAST(COUNT(*) AS DOUBLE) / NULLIF(COUNT(DISTINCT matchId), 0)
           FROM MatchPlayers)                                              AS avgPlayersPerMatch;

    -- ── 2. headToHead ─────────────────────────────────────────────────────────
    WITH teamsInMatch AS (
        SELECT DISTINCT matchId, team FROM MatchPlayers
    ),
    pairs AS (
        SELECT a.matchId, a.team AS teamA, b.team AS teamB
        FROM teamsInMatch a
        INNER JOIN teamsInMatch b ON b.matchId = a.matchId AND b.team > a.team
    )
    SELECT
        pr.teamA,
        pr.teamB,
        m.isDerby,
        CAST(COUNT(*)                                AS SIGNED) AS matches,
        CAST(SUM(m.winnerTeam = pr.teamA)            AS SIGNED) AS winsA,
        CAST(SUM(m.winnerTeam = pr.teamB)            AS SIGNED) AS winsB,
        CAST(SUM(m.winnerTeam IS NULL)               AS SIGNED) AS draws,
        CAST(SUM(m.winnerTeam = pr.teamA) AS DOUBLE) / COUNT(*) AS winRateA,
        CAST(SUM(m.winnerTeam = pr.teamB) AS DOUBLE) / COUNT(*) AS winRateB,
        CAST(AVG(m.goalsDiference)                   AS DOUBLE) AS avgGoalsDiference
    FROM pairs pr
    INNER JOIN Matches m ON m.matchId = pr.matchId
    GROUP BY pr.teamA, pr.teamB, m.isDerby
    ORDER BY m.isDerby, pr.teamA, pr.teamB;

    -- ── 3. championsRanking ───────────────────────────────────────────────────
    SELECT
        p.playerId,
        p.displayName,
        p.photo,
        p.cups,
        p.championships
    FROM vPlayerDetail p
    WHERE p.cups > 0
    ORDER BY p.cups DESC, p.displayName;

    -- ── 4. tournamentsTimeline ────────────────────────────────────────────────
    SELECT
        td.tournamentId,
        td.`name` AS tournamentName,
        td.startedAt,
        td.endedAt,
        td.state,
        td.wasTracked,
        td.matchesCount,
        td.derbiesCount,
        td.playersCount,
        td.championPlayerId,
        td.championName
    FROM vTournamentDetail td
    ORDER BY td.startedAt, td.tournamentId;

    -- ── 5. topWinRate ─────────────────────────────────────────────────────────
    -- Con un minimo de partidos: sin el, el podio lo copa quien jugo dos veces
    -- y gano las dos.
    SELECT
        g.`position`,
        g.playerId,
        p.displayName,
        p.photo,
        p.cups,
        g.played,
        g.won,
        g.drew,
        g.lost,
        g.winRate,
        g.netPoints
    FROM vGeneralStandings g
    INNER JOIN vPlayerDetail p ON p.playerId = g.playerId
    WHERE g.played >= COALESCE(pMinMatches, 0)
    ORDER BY g.winRate DESC, g.played DESC, p.displayName;

    -- ── 6. records ────────────────────────────────────────────────────────────
    SELECT
        (SELECT CAST(MAX(goalsDiference) AS SIGNED) FROM Matches)            AS biggestWinMargin,
        (SELECT matchId FROM Matches ORDER BY goalsDiference DESC, playedAt LIMIT 1)
                                                                             AS biggestWinMatchId,
        (SELECT CAST(MAX(squad) AS SIGNED) FROM (
            SELECT COUNT(*) AS squad FROM MatchPlayers GROUP BY matchId
         ) s)                                                                AS biggestSquad,
        (SELECT CAST(MAX(played) AS SIGNED) FROM vGeneralScoreboard)         AS mostMatchesPlayed,
        (SELECT CAST(MAX(cups) AS SIGNED) FROM vPlayerDetail)                AS mostCups;

    -- ── 7. streakRecords ──────────────────────────────────────────────────────
    -- Las rachas invictas mas largas de la historia, con quien y cuando. Es el
    -- record que la gente recuerda; los demas maximos del result set anterior
    -- son numeros sueltos y este tiene protagonista.
    --
    -- `isOpen` marca las que siguen vivas: una racha abierta se lee distinto,
    -- todavia puede crecer.
    SELECT
        s.playerId,
        p.displayName,
        p.photo,
        s.length,
        s.startedAt,
        s.endedAt,
        s.isOpen
    FROM vPlayerStreakIslands s
    INNER JOIN vPlayerDetail p ON p.playerId = s.playerId
    WHERE s.kind = 'UNBEATEN'
      AND s.length >= 5
    ORDER BY s.length DESC, s.endedAt DESC
    LIMIT 5;

    -- ── 8. winlessRecords ─────────────────────────────────────────────────────
    -- El espejo del anterior: los tramos sin ganar mas largos. Misma consulta
    -- cambiando una constante, mismo minimo y mismo tope, porque las dos tablas
    -- se leen una al lado de la otra y con distinto corte no se comparan.
    --
    -- Cuenta partidos sin ganar, que es EXACTAMENTE la misma medida del
    -- descenso: cada ocho de estos es una bajada de categoria. Las dos tablas
    -- miden lo mismo a distinta escala, y por eso van una pegada a la otra.
    SELECT
        s.playerId,
        p.displayName,
        p.photo,
        s.length,
        s.startedAt,
        s.endedAt,
        s.isOpen
    FROM vPlayerStreakIslands s
    INNER JOIN vPlayerDetail p ON p.playerId = s.playerId
    WHERE s.kind = 'WINLESS'
      AND s.length >= 5
    ORDER BY s.length DESC, s.endedAt DESC
    LIMIT 5;

    -- ── 9. relegations ────────────────────────────────────────────────────────
    -- La tabla de descensos: solo los que bajaron alguna vez, SIN TOPE. No es
    -- un podio de cinco como las dos de arriba —esas se recortan porque hay
    -- rachas de sobra—: aca la lista es corta por naturaleza y va completa. El
    -- que no esta es porque no descendio.
    SELECT
        r.playerId,
        p.displayName,
        p.photo,
        r.relegations,
        r.allLossRelegations,
        r.firstRelegationAt,
        r.lastRelegationAt
    FROM vPlayerRelegations r
    INNER JOIN vPlayerDetail p ON p.playerId = r.playerId
    WHERE r.relegations > 0
    ORDER BY r.relegations DESC, r.lastRelegationAt DESC, p.displayName;
END //
DELIMITER ;
