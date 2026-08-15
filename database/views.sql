-- =============================================================================
-- murieron-en-madrid — vistas
-- =============================================================================
-- Aca vive el motor de calculo del sistema. Los stored procedures no repiten
-- una sola formula: consultan estas vistas. La regla de negocio queda escrita
-- una vez y todas las tablas (torneo, historica, estadisticas) la comparten.
--
-- La cadena es:
--   vMatchPlayerResults    partido+jugador -> resultado y diferencia con signo
--   vPlayerTournamentTotals            suma por jugador dentro de un torneo
--   vTournamentScoreboard              + puntos, techo, winrate y penalizacion
--   vTournamentStandings               + posicion (desempate oficial)
--   vTournamentChampions               el 1o de cada torneo finalizado
--   vGeneralScoreboard / vGeneralStandings   lo mismo sumando todos los torneos
--
-- DESEMPATE OFICIAL, identico en toda tabla del sistema:
--   1) puntos netos  2) diferencia de gol  3) winrate  4) playerId (determinismo)
--
-- Una vista de MySQL no ocupa disco: es una consulta guardada que el
-- optimizador fusiona con la query que la usa.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- vMatchPlayerResults — el partido visto desde cada jugador
-- -----------------------------------------------------------------------------
-- Matches guarda el margen sin signo y de que lado cayo (winnerTeam). Un jugador
-- necesita las dos cosas resueltas: si gano, empato o perdio, y la diferencia ya
-- firmada desde su punto de vista. Todo lo demas del sistema parte de aca.
CREATE OR REPLACE VIEW vMatchPlayerResults AS
SELECT
  mp.playerId,
  mp.matchId,
  mp.tournamentId,
  mp.team,
  m.winnerTeam,
  m.isDerby,
  m.place,
  m.playedAt,
  CASE
    WHEN m.winnerTeam IS NULL     THEN 'D'
    WHEN m.winnerTeam = mp.team   THEN 'W'
    ELSE 'L'
  END AS result,
  CASE
    WHEN m.winnerTeam IS NULL     THEN 0
    WHEN m.winnerTeam = mp.team   THEN m.goalsDiference
    ELSE -m.goalsDiference
  END AS goalsDiference
FROM MatchPlayers mp
INNER JOIN Matches m ON m.matchId = mp.matchId;

-- -----------------------------------------------------------------------------
-- vPlayerTournamentTotals — PJ/G/E/P y diferencia de un jugador en un torneo
-- -----------------------------------------------------------------------------
-- Los CAST AS SIGNED no son cosmeticos: SUM() sobre enteros devuelve DECIMAL en
-- MySQL, y el driver entrega los DECIMAL como string. Sin el cast, `won` llegaria
-- al frontend como "4" en vez de 4. Misma razon en todas las vistas de abajo.
CREATE OR REPLACE VIEW vPlayerTournamentTotals AS
SELECT
  r.playerId,
  r.tournamentId,
  CAST(COUNT(*)              AS SIGNED) AS played,
  CAST(SUM(r.result = 'W')   AS SIGNED) AS won,
  CAST(SUM(r.result = 'D')   AS SIGNED) AS drew,
  CAST(SUM(r.result = 'L')   AS SIGNED) AS lost,
  CAST(SUM(r.goalsDiference) AS SIGNED) AS goalsDiference
FROM vMatchPlayerResults r
GROUP BY r.playerId, r.tournamentId;

-- -----------------------------------------------------------------------------
-- vTournamentScoreboard — la tabla de un torneo, sin ordenar
-- -----------------------------------------------------------------------------
-- points  = puntos brutos segun la puntuacion del torneo.
-- maxPoints = techo posible: como si hubiera ganado todos los que jugo.
-- winRate = points / maxPoints. Es rendimiento sobre puntos posibles, NO el
--   porcentaje de partidos ganados: un torneo que paga 1 por perder da winrate
--   33% al que pierde todo. Asi lo calculaba el sistema original y asi se
--   mantiene, porque es la metrica que la gente ya conoce.
-- netPoints = points - penalizacion. Es la columna que define al campeon.
--
-- La penalizacion se resta pero NO afecta el winrate: castiga la tabla, no el
-- rendimiento deportivo.
--
-- El subselect existe porque MySQL no deja reusar un alias del SELECT (points)
-- en otra expresion del mismo SELECT.
CREATE OR REPLACE VIEW vTournamentScoreboard AS
SELECT
  b.tournamentId,
  b.playerId,
  b.played,
  b.won,
  b.drew,
  b.lost,
  b.goalsDiference,
  b.points,
  b.maxPoints,
  CASE WHEN b.maxPoints > 0 THEN b.points / b.maxPoints ELSE NULL END AS winRate,
  b.penalty,
  b.points - b.penalty AS netPoints
FROM (
  SELECT
    tot.tournamentId,
    tot.playerId,
    tot.played,
    tot.won,
    tot.drew,
    tot.lost,
    tot.goalsDiference,
    (t.winningPoints * tot.won
      + t.drawingPoints * tot.drew
      + t.lossingPoints * tot.lost)  AS points,
    (t.winningPoints * tot.played)   AS maxPoints,
    COALESCE(pp.penalty, 0)          AS penalty
  FROM vPlayerTournamentTotals tot
  INNER JOIN Tournaments t
    ON t.tournamentId = tot.tournamentId
  LEFT JOIN PlayerPenalties pp
    ON pp.tournamentId = tot.tournamentId
   AND pp.playerId     = tot.playerId
) b;

-- -----------------------------------------------------------------------------
-- vTournamentStandings — la tabla de un torneo, ya ordenada y numerada
-- -----------------------------------------------------------------------------
-- El frontend recibe las filas en este orden y solo las pinta: el criterio de
-- desempate no se reimplementa en ningun cliente.
CREATE OR REPLACE VIEW vTournamentStandings AS
SELECT
  s.tournamentId,
  s.playerId,
  s.played,
  s.won,
  s.drew,
  s.lost,
  s.goalsDiference,
  s.points,
  s.maxPoints,
  s.winRate,
  s.penalty,
  s.netPoints,
  ROW_NUMBER() OVER (
    PARTITION BY s.tournamentId
    ORDER BY s.netPoints DESC, s.goalsDiference DESC, s.winRate DESC, s.playerId ASC
  ) AS `position`
FROM vTournamentScoreboard s;

-- -----------------------------------------------------------------------------
-- vTournamentChampions — quien gano cada torneo
-- -----------------------------------------------------------------------------
-- Solo torneos finalizados: el puntero de un torneo en curso no es campeon de
-- nada todavia. De aca salen las estrellas del perfil de cada jugador.
CREATE OR REPLACE VIEW vTournamentChampions AS
SELECT
  st.tournamentId,
  st.playerId
FROM vTournamentStandings st
INNER JOIN Tournaments t ON t.tournamentId = st.tournamentId
WHERE t.state = 'F'
  AND st.`position` = 1;

-- -----------------------------------------------------------------------------
-- vPlayerChampionships — los titulos de cada jugador, con el detalle del torneo
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW vPlayerChampionships AS
SELECT
  c.playerId,
  c.tournamentId,
  t.`name`  AS tournamentName,
  t.endedAt AS tournamentEndedAt
FROM vTournamentChampions c
INNER JOIN Tournaments t ON t.tournamentId = c.tournamentId;

-- -----------------------------------------------------------------------------
-- vPlayerDetail — el jugador tal como lo devuelve la API
-- -----------------------------------------------------------------------------
-- Agrega las dos columnas calculadas que el frontend necesita en TODO get de
-- jugadores: cuantas copas tiene (las estrellas) y cuales (el detalle al tocar).
-- Se calculan aca y no en la aplicacion, como pide el requerimiento.
--
-- championships viaja como JSON y el pool lo entrega ya parseado (typeCast).
CREATE OR REPLACE VIEW vPlayerDetail AS
SELECT
  p.playerId,
  p.firstName,
  p.secondName,
  p.nickname,
  -- Nombre para mostrar, resuelto una sola vez y en un solo lugar: el apodo si
  -- lo tiene (asi se conoce a casi todos), el nombre completo si no.
  COALESCE(NULLIF(p.nickname, ''), CONCAT(p.firstName, ' ', p.secondName)) AS displayName,
  p.photo,
  p.state,
  p.isSagrado,
  p.createdAt,
  COALESCE(ch.cups, 0)                    AS cups,
  COALESCE(ch.championships, JSON_ARRAY()) AS championships
FROM Players p
LEFT JOIN (
  SELECT
    ordered.playerId,
    CAST(COUNT(*) AS SIGNED) AS cups,
    JSON_ARRAYAGG(
      JSON_OBJECT('tournamentId', ordered.tournamentId, 'name', ordered.tournamentName)
    ) AS championships
  FROM (
    SELECT playerId, tournamentId, tournamentName
    FROM vPlayerChampionships
    ORDER BY playerId, tournamentEndedAt
  ) ordered
  GROUP BY ordered.playerId
) ch ON ch.playerId = p.playerId;

-- -----------------------------------------------------------------------------
-- vPlayerPenaltyDetail — la penalizacion con los nombres ya resueltos
-- -----------------------------------------------------------------------------
-- Una penalizacion sola no dice nada: siempre se muestra junto a quien la
-- recibio y en que torneo.
CREATE OR REPLACE VIEW vPlayerPenaltyDetail AS
SELECT
  pp.playerId,
  pp.tournamentId,
  pp.penalty,
  p.displayName AS playerName,
  p.photo       AS playerPhoto,
  t.`name`      AS tournamentName,
  t.state       AS tournamentState
FROM PlayerPenalties pp
INNER JOIN vPlayerDetail p ON p.playerId     = pp.playerId
INNER JOIN Tournaments   t ON t.tournamentId = pp.tournamentId;

-- -----------------------------------------------------------------------------
-- vGeneralScoreboard — la tabla historica, sin ordenar
-- -----------------------------------------------------------------------------
-- Suma los totales de todos los torneos. El winrate historico es puntos totales
-- sobre techo total: cada torneo pesa segun su propia puntuacion, que es lo
-- correcto cuando la Clausura paga 0.25 por perder y la Apertura pagaba 1.
CREATE OR REPLACE VIEW vGeneralScoreboard AS
SELECT
  b.playerId,
  b.tournamentsPlayed,
  b.played,
  b.won,
  b.drew,
  b.lost,
  b.goalsDiference,
  b.points,
  b.maxPoints,
  CASE WHEN b.maxPoints > 0 THEN b.points / b.maxPoints ELSE NULL END AS winRate,
  b.penalty,
  b.points - b.penalty AS netPoints
FROM (
  SELECT
    s.playerId,
    CAST(COUNT(DISTINCT s.tournamentId) AS SIGNED) AS tournamentsPlayed,
    CAST(SUM(s.played)                  AS SIGNED) AS played,
    CAST(SUM(s.won)                     AS SIGNED) AS won,
    CAST(SUM(s.drew)                    AS SIGNED) AS drew,
    CAST(SUM(s.lost)                    AS SIGNED) AS lost,
    CAST(SUM(s.goalsDiference)          AS SIGNED) AS goalsDiference,
    SUM(s.points)                                  AS points,
    SUM(s.maxPoints)                               AS maxPoints,
    SUM(s.penalty)                                 AS penalty
  FROM vTournamentScoreboard s
  GROUP BY s.playerId
) b;

-- -----------------------------------------------------------------------------
-- vGeneralStandings — la tabla historica, ordenada y numerada
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW vGeneralStandings AS
SELECT
  g.playerId,
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
  g.netPoints,
  ROW_NUMBER() OVER (
    ORDER BY g.netPoints DESC, g.goalsDiference DESC, g.winRate DESC, g.playerId ASC
  ) AS `position`
FROM vGeneralScoreboard g;

-- -----------------------------------------------------------------------------
-- vMatchDetail — el partido con su convocatoria ya armada
-- -----------------------------------------------------------------------------
-- Evita el N+1 clasico: un solo result set trae el partido y sus dos equipos
-- como JSON, listo para que la factory arme la entidad.
CREATE OR REPLACE VIEW vMatchDetail AS
SELECT
  m.matchId,
  m.tournamentId,
  t.`name` AS tournamentName,
  m.winnerTeam,
  m.goalsDiference,
  m.place,
  m.playedAt,
  m.isDerby,
  COALESCE(pl.players, JSON_ARRAY()) AS players
FROM Matches m
INNER JOIN Tournaments t ON t.tournamentId = m.tournamentId
LEFT JOIN (
  SELECT
    ordered.matchId,
    JSON_ARRAYAGG(
      JSON_OBJECT(
        'playerId',    ordered.playerId,
        'team',        ordered.team,
        'firstName',   ordered.firstName,
        'secondName',  ordered.secondName,
        'nickname',    ordered.nickname,
        'displayName', ordered.displayName,
        'photo',       ordered.photo
      )
    ) AS players
  FROM (
    SELECT mp.matchId, mp.playerId, mp.team,
           p.firstName, p.secondName, p.nickname, p.displayName, p.photo
    FROM MatchPlayers mp
    INNER JOIN vPlayerDetail p ON p.playerId = mp.playerId
    ORDER BY mp.matchId, mp.team, p.displayName
  ) ordered
  GROUP BY ordered.matchId
) pl ON pl.matchId = m.matchId;

-- -----------------------------------------------------------------------------
-- vTournamentDetail — el torneo tal como lo devuelve la API
-- -----------------------------------------------------------------------------
-- Suma los contadores que el listado necesita para no pedir nada extra
-- (cuantos partidos lleva, cuanta gente jugo) y quien salio campeon, que ya
-- esta resuelto en vTournamentChampions.
CREATE OR REPLACE VIEW vTournamentDetail AS
SELECT
  t.tournamentId,
  t.`name`,
  t.startedAt,
  t.endedAt,
  t.state,
  t.wasTracked,
  t.winningPoints,
  t.lossingPoints,
  t.drawingPoints,
  t.createdAt,
  COALESCE(mt.matchesCount, 0)   AS matchesCount,
  COALESCE(mt.derbiesCount, 0)   AS derbiesCount,
  COALESCE(mp.playersCount, 0)   AS playersCount,
  COALESCE(pe.penaltiesCount, 0) AS penaltiesCount,
  ch.playerId                    AS championPlayerId,
  cp.displayName                 AS championName
FROM Tournaments t
LEFT JOIN (
  SELECT tournamentId,
         CAST(COUNT(*)         AS SIGNED) AS matchesCount,
         CAST(SUM(isDerby = 1) AS SIGNED) AS derbiesCount
  FROM Matches
  GROUP BY tournamentId
) mt ON mt.tournamentId = t.tournamentId
LEFT JOIN (
  SELECT tournamentId, CAST(COUNT(DISTINCT playerId) AS SIGNED) AS playersCount
  FROM MatchPlayers
  GROUP BY tournamentId
) mp ON mp.tournamentId = t.tournamentId
LEFT JOIN (
  SELECT tournamentId, CAST(COUNT(*) AS SIGNED) AS penaltiesCount
  FROM PlayerPenalties
  GROUP BY tournamentId
) pe ON pe.tournamentId = t.tournamentId
LEFT JOIN vTournamentChampions ch ON ch.tournamentId = t.tournamentId
LEFT JOIN vPlayerDetail cp        ON cp.playerId     = ch.playerId;

-- =============================================================================
-- MUNDIALITO
-- =============================================================================
-- Un torneo paralelo que no existe en ninguna tabla: se deduce del historial.
-- Cada jugador corre su propio mundial sobre sus partidos en orden cronologico,
-- sin importar de que torneo sean.
--
-- El formato son 8 partidos: tres de fase de grupos y cinco de eliminacion
-- directa (16avos, 8avos, 4tos, semis, final). Se paga 3 / 1 / 0 —la puntuacion
-- del torneo NO se usa aca; en el mundialito todos los partidos valen igual—.
-- Al cerrar el tercer partido hacen falta 4 puntos para pasar de grupos. Desde
-- los 16avos, perder elimina y empatar alcanza para seguir; la final se gana
-- ganando o empatando. Al quedar eliminado o al salir campeon, el siguiente
-- partido que juegue arranca un mundialito nuevo desde la fase de grupos.
--
-- La cadena es:
--   vMundialitoMatches   partidos elegibles, numerados por jugador
--   vMundialitoRuns      + en que mundialito, en que puesto y como termino
--   vMundialitoCurrent   el mundialito vigente de cada jugador, listo para pintar
--   vMundialitoTitles    cuantos gano cada uno y cuando gano el primero
-- =============================================================================

-- -----------------------------------------------------------------------------
-- vMundialitoMatches — la secuencia de partidos de cada jugador
-- -----------------------------------------------------------------------------
-- Se excluyen los torneos wasTracked = FALSE: de esos solo sobrevivio la tabla
-- final y sus "partidos" son reconstrucciones para cuadrarla (cinco filas para
-- todo 2024). Contarlos inventaria fases y eliminaciones que nunca pasaron.
--
-- El orden es (playedAt, matchId). La fecha sola alcanzaria hoy —nunca se
-- jugaron dos partidos el mismo dia— pero el matchId lo deja determinista para
-- cuando pase.
CREATE OR REPLACE VIEW vMundialitoMatches AS
SELECT
  r.playerId,
  r.matchId,
  r.tournamentId,
  r.playedAt,
  r.result,
  CAST(ROW_NUMBER() OVER (
    PARTITION BY r.playerId
    ORDER BY r.playedAt, r.matchId
  ) AS SIGNED) AS n
FROM vMatchPlayerResults r
INNER JOIN Tournaments t ON t.tournamentId = r.tournamentId
WHERE t.wasTracked = TRUE;

-- -----------------------------------------------------------------------------
-- vMundialitoRuns — cada partido ubicado dentro del mundialito que le tocó
-- -----------------------------------------------------------------------------
-- Esto es un plegado con reinicio: el estado de un partido depende del anterior
-- y no hay forma de expresarlo con una agregacion. Por eso el CTE recursivo,
-- que recorre la secuencia de cada jugador de a un partido por iteracion (todos
-- los jugadores avanzan en paralelo, asi que la profundidad es la del historial
-- mas largo, hoy 60).
--
-- Dentro de la recursion viaja lo minimo indispensable —numero de mundialito,
-- puesto, puntos de grupo y desenlace—; todo lo derivable (la fase, los puntos
-- del partido) se calcula afuera. Cuanto menos lleve el paso recursivo, menos
-- lugares donde equivocarse con los tipos.
--
-- OJO con los CAST del ancla: en MySQL el tipo de cada columna de un CTE
-- recursivo lo fija la primera consulta. Sin el CAST a CHAR(8), 'ALIVE' define
-- un CHAR(5) y 'CHAMPION' entra truncado como 'CHAMP'.
--
-- outcome es el estado DESPUES de jugar ese partido:
--   ALIVE     sigue vivo en su mundialito
--   OUT       quedo eliminado en ese partido
--   CHAMPION  gano el mundialito en ese partido
CREATE OR REPLACE VIEW vMundialitoRuns AS
WITH RECURSIVE walk AS (
  -- El primer partido de cada jugador: siempre abre un mundialito y nunca
  -- elimina, porque el primero de la fase de grupos no define nada.
  SELECT
    m.playerId,
    m.matchId,
    m.playedAt,
    m.result,
    m.n,
    CAST(1 AS SIGNED) AS runIndex,
    CAST(1 AS SIGNED) AS slot,
    CAST(CASE m.result WHEN 'W' THEN 3 WHEN 'D' THEN 1 ELSE 0 END AS SIGNED) AS groupPoints,
    CAST('ALIVE' AS CHAR(8)) AS outcome
  FROM vMundialitoMatches m
  WHERE m.n = 1

  UNION ALL

  SELECT
    m.playerId,
    m.matchId,
    m.playedAt,
    m.result,
    m.n,
    -- Si el partido anterior cerro un mundialito (eliminado o campeon), este
    -- abre el siguiente.
    CASE WHEN prev.outcome = 'ALIVE' THEN prev.runIndex ELSE prev.runIndex + 1 END,
    CASE WHEN prev.outcome = 'ALIVE' THEN prev.slot + 1 ELSE 1 END,
    -- Los puntos de grupo se acumulan en los tres primeros puestos y despues
    -- quedan congelados: en la eliminacion directa ya no deciden nada, pero se
    -- conservan para poder mostrar como se clasifico.
    CASE
      WHEN prev.outcome <> 'ALIVE' OR prev.slot + 1 <= 3
        THEN CASE WHEN prev.outcome = 'ALIVE' THEN prev.groupPoints ELSE 0 END
           + CASE m.result WHEN 'W' THEN 3 WHEN 'D' THEN 1 ELSE 0 END
      ELSE prev.groupPoints
    END,
    CASE
      -- Mundialito nuevo: el puesto 1 no define nada.
      WHEN prev.outcome <> 'ALIVE' THEN 'ALIVE'
      -- Fase de grupos: queda afuera cuando ya no le alcanza, aunque le queden
      -- partidos. Ganando todo lo que le queda suma 3 por partido; si ni asi
      -- llega a 4, el mundialito se termina ahi y no se juega una tercera fecha
      -- que no puede cambiar nada. En la practica pasa con dos derrotas: 0 + 3
      -- es menos que 4.
      WHEN prev.slot + 1 <= 3 THEN
        CASE
          WHEN prev.groupPoints
             + CASE m.result WHEN 'W' THEN 3 WHEN 'D' THEN 1 ELSE 0 END
             + 3 * (3 - (prev.slot + 1)) >= 4
          THEN 'ALIVE'
          ELSE 'OUT'
        END
      -- Eliminacion directa: perder es quedar afuera; el empate pasa de ronda,
      -- y pasar de ronda en la final es dar la vuelta.
      WHEN m.result = 'L' THEN 'OUT'
      WHEN prev.slot + 1 = 8 THEN 'CHAMPION'
      ELSE 'ALIVE'
    END
  FROM walk prev
  INNER JOIN vMundialitoMatches m
    ON m.playerId = prev.playerId
   AND m.n        = prev.n + 1
)
SELECT
  w.playerId,
  w.matchId,
  w.playedAt,
  w.result,
  w.n,
  w.runIndex,
  w.slot,
  w.groupPoints,
  w.outcome,
  CAST(CASE w.result WHEN 'W' THEN 3 WHEN 'D' THEN 1 ELSE 0 END AS SIGNED) AS points,
  CASE
    WHEN w.slot <= 3 THEN 'GROUP'
    WHEN w.slot = 4  THEN 'R16'
    WHEN w.slot = 5  THEN 'R8'
    WHEN w.slot = 6  THEN 'R4'
    WHEN w.slot = 7  THEN 'SF'
    ELSE 'F'
  END AS phase
FROM walk w;

-- -----------------------------------------------------------------------------
-- vMundialitoTitles — los mundialitos ganados por cada jugador
-- -----------------------------------------------------------------------------
-- firstTitleAt es el desempate del medallero: entre dos jugadores con la misma
-- cantidad de copas va primero el que la consiguio antes, igual que en la
-- vitrina de torneos.
CREATE OR REPLACE VIEW vMundialitoTitles AS
SELECT
  r.playerId,
  CAST(COUNT(*) AS SIGNED) AS titles,
  MIN(r.playedAt)          AS firstTitleAt,
  MAX(r.playedAt)          AS lastTitleAt
FROM vMundialitoRuns r
WHERE r.outcome = 'CHAMPION'
GROUP BY r.playerId;

-- -----------------------------------------------------------------------------
-- vMundialitoCurrent — el mundialito vigente de cada jugador
-- -----------------------------------------------------------------------------
-- Vigente es el de mayor runIndex, este abierto o cerrado: un jugador que quedo
-- eliminado sigue mostrando ESA corrida —con su pelota roja— hasta que juegue
-- otro partido y arranque la siguiente. Lo mismo el campeon.
--
-- balls viaja como JSON con un objeto por partido jugado; las que faltan hasta
-- ocho las dibuja el frontend en gris. Se arma aca por la misma razon que en
-- vMatchDetail: un solo result set en vez de una consulta por jugador.
CREATE OR REPLACE VIEW vMundialitoCurrent AS
SELECT
  cur.playerId,
  cur.runIndex,
  cur.played,
  cur.groupPoints,
  cur.status,
  cur.lastPlayedAt,
  -- Puesto que va a ocupar el proximo partido: el que sigue si esta vivo, y el
  -- 1 del mundialito nuevo si la corrida ya cerro.
  CAST(CASE WHEN cur.status = 'ALIVE' THEN cur.played + 1 ELSE 1 END AS SIGNED) AS nextSlot,
  -- Fase en la que quedo la corrida: la del ultimo partido jugado.
  CASE
    WHEN cur.played <= 3 THEN 'GROUP'
    WHEN cur.played = 4  THEN 'R16'
    WHEN cur.played = 5  THEN 'R8'
    WHEN cur.played = 6  THEN 'R4'
    WHEN cur.played = 7  THEN 'SF'
    ELSE 'F'
  END AS phase,
  balls.balls
FROM (
  SELECT
    r.playerId,
    r.runIndex,
    CAST(COUNT(*) AS SIGNED)  AS played,
    MAX(r.groupPoints)        AS groupPoints,
    MAX(r.playedAt)           AS lastPlayedAt,
    -- El desenlace de la corrida es el del ultimo partido: los anteriores son
    -- todos ALIVE por construccion.
    SUBSTRING_INDEX(
      GROUP_CONCAT(r.outcome ORDER BY r.slot DESC SEPARATOR ','), ',', 1
    ) AS status
  FROM vMundialitoRuns r
  INNER JOIN (
    SELECT playerId, MAX(runIndex) AS runIndex
    FROM vMundialitoRuns
    GROUP BY playerId
  ) last
    ON last.playerId = r.playerId
   AND last.runIndex = r.runIndex
  GROUP BY r.playerId, r.runIndex
) cur
LEFT JOIN (
  SELECT
    ordered.playerId,
    JSON_ARRAYAGG(
      JSON_OBJECT(
        'slot',    ordered.slot,
        'phase',   ordered.phase,
        'result',  ordered.result,
        'points',  ordered.points,
        'matchId', ordered.matchId
      )
    ) AS balls
  FROM (
    SELECT r.playerId, r.slot, r.phase, r.result, r.points, r.matchId
    FROM vMundialitoRuns r
    INNER JOIN (
      SELECT playerId, MAX(runIndex) AS runIndex
      FROM vMundialitoRuns
      GROUP BY playerId
    ) last
      ON last.playerId = r.playerId
     AND last.runIndex = r.runIndex
    ORDER BY r.playerId, r.slot
  ) ordered
  GROUP BY ordered.playerId
) balls ON balls.playerId = cur.playerId;
