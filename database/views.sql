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
--   vMundialitoRunBalls  cada corrida con sus partidos armados para pintar
--   vMundialitoCurrent   el mundialito vigente de cada jugador
--   vMundialitoBestRun   el mejor que corrio cada uno
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
-- vMundialitoEndedRuns — las corridas que ya terminaron
-- -----------------------------------------------------------------------------
-- Una fila por mundialito cerrado (eliminado o campeon), con el partido en el
-- que se cerro y hasta donde llego.
--
-- Es la base de casi toda estadistica del mundialito, y deja afuera la corrida
-- en curso a proposito: un porcentaje de clasificacion necesita un denominador
-- de corridas terminadas. Contar la que se esta jugando adentro haria que el
-- numero se moviera segun el dia, sin que nadie haya quedado afuera.
--
-- qualified = paso la fase de grupos. Llegar al puesto 4 es exactamente eso,
-- haya perdido ahi o mas adelante.
CREATE OR REPLACE VIEW vMundialitoEndedRuns AS
SELECT
  r.playerId,
  r.runIndex,
  r.matchId,
  r.playedAt,
  r.slot     AS lastSlot,
  r.outcome,
  CAST(r.slot >= 4 AS SIGNED) AS qualified
FROM vMundialitoRuns r
WHERE r.outcome <> 'ALIVE';

-- -----------------------------------------------------------------------------
-- vMundialitoPlayerStats — el rendimiento historico de cada jugador
-- -----------------------------------------------------------------------------
-- Incluye a TODOS los jugadores, con ceros si nunca jugaron: el perfil de
-- alguien recien creado tiene que abrir igual. La tabla de la solapa filtra por
-- su cuenta a los que tienen partidos.
--
-- droughtRuns es la sequia: cuantas corridas terminadas lleva sin clasificar.
-- Sale de restar indices y no de recorrer el historial porque los mundialitos
-- terminados de un jugador estan numerados 1..N sin huecos: si el ultimo es el
-- 11 y el ultimo que clasifico fue el 9, hace dos que no pasa de grupos.
CREATE OR REPLACE VIEW vMundialitoPlayerStats AS
SELECT
  p.playerId,
  COALESCE(ended.runsEnded, 0)                                AS runsEnded,
  COALESCE(ended.qualified, 0)                                AS qualified,
  CASE WHEN ended.runsEnded > 0
       THEN ended.qualified / ended.runsEnded END             AS qualifiedRate,
  CASE WHEN ended.runsEnded > 0
       THEN ended.totalLength / ended.runsEnded END           AS avgRunLength,
  COALESCE(ended.lastRun, 0) - COALESCE(ended.lastQualifiedRun, 0) AS droughtRuns,
  COALESCE(ko.koPlayed, 0)                                    AS koPlayed,
  COALESCE(ko.koPassed, 0)                                    AS koPassed,
  CASE WHEN ko.koPlayed > 0
       THEN ko.koPassed / ko.koPlayed END                     AS koRate,
  COALESCE(ko.semis, 0)                                       AS semis,
  COALESCE(ko.finals, 0)                                      AS finals,
  COALESCE(all_.matchesPlayed, 0)                             AS matchesPlayed,
  COALESCE(all_.runsPlayed, 0)                                AS runsPlayed,
  COALESCE(all_.titles, 0)                                    AS titles,
  COALESCE(all_.eliminations, 0)                              AS eliminations,
  COALESCE(all_.bestSlot, 0)                                  AS bestSlot,
  COALESCE(perfect.perfectRuns, 0)                            AS perfectRuns
FROM Players p
LEFT JOIN (
  SELECT
    e.playerId,
    CAST(COUNT(*)                  AS SIGNED) AS runsEnded,
    CAST(SUM(e.qualified)          AS SIGNED) AS qualified,
    CAST(SUM(e.lastSlot)           AS SIGNED) AS totalLength,
    CAST(MAX(e.runIndex)           AS SIGNED) AS lastRun,
    CAST(MAX(CASE WHEN e.qualified = 1 THEN e.runIndex END) AS SIGNED) AS lastQualifiedRun
  FROM vMundialitoEndedRuns e
  GROUP BY e.playerId
) ended ON ended.playerId = p.playerId
LEFT JOIN (
  -- Eliminacion directa: del puesto 4 en adelante. Superar es no perder, que es
  -- la misma regla con la que se pasa de ronda.
  SELECT
    r.playerId,
    CAST(COUNT(*)                    AS SIGNED) AS koPlayed,
    CAST(SUM(r.result <> 'L')        AS SIGNED) AS koPassed,
    CAST(SUM(r.slot = 7)             AS SIGNED) AS semis,
    CAST(SUM(r.slot = 8)             AS SIGNED) AS finals
  FROM vMundialitoRuns r
  WHERE r.slot >= 4
  GROUP BY r.playerId
) ko ON ko.playerId = p.playerId
LEFT JOIN (
  SELECT
    r.playerId,
    CAST(COUNT(*)                          AS SIGNED) AS matchesPlayed,
    CAST(MAX(r.runIndex)                   AS SIGNED) AS runsPlayed,
    CAST(SUM(r.outcome = 'CHAMPION')       AS SIGNED) AS titles,
    CAST(SUM(r.outcome = 'OUT')            AS SIGNED) AS eliminations,
    CAST(MAX(r.slot)                       AS SIGNED) AS bestSlot
  FROM vMundialitoRuns r
  GROUP BY r.playerId
) all_ ON all_.playerId = p.playerId
LEFT JOIN (
  -- El mundialito perfecto: ocho partidos, ocho victorias.
  SELECT run.playerId, CAST(COUNT(*) AS SIGNED) AS perfectRuns
  FROM (
    SELECT r.playerId, r.runIndex
    FROM vMundialitoRuns r
    GROUP BY r.playerId, r.runIndex
    HAVING COUNT(*) = 8 AND SUM(r.result = 'W') = 8
  ) run
  GROUP BY run.playerId
) perfect ON perfect.playerId = p.playerId;

-- -----------------------------------------------------------------------------
-- vMundialitoKnockouts — quien estaba enfrente cuando alguien quedo afuera
-- -----------------------------------------------------------------------------
-- Una fila por rival presente en el partido que elimino a un jugador. Ojo con
-- leerla como un duelo: en el mundialito no se pierde contra una persona sino
-- contra un equipo, asi que esto es "estaba del otro lado", no "te gano el".
--
-- Solo eliminaciones POR DERROTA. En la fase de grupos se puede quedar afuera
-- empatando —o incluso ganando el tercero, si venia de dos derrotas—, y ahi no
-- hay nadie a quien atribuirselo.
CREATE OR REPLACE VIEW vMundialitoKnockouts AS
SELECT
  r.playerId      AS eliminatedId,
  other.playerId  AS rivalId,
  r.matchId,
  r.playedAt,
  r.slot,
  r.runIndex
FROM vMundialitoRuns r
INNER JOIN MatchPlayers mine
  ON mine.matchId  = r.matchId
 AND mine.playerId = r.playerId
INNER JOIN MatchPlayers other
  ON other.matchId = r.matchId
 AND other.team   <> mine.team
WHERE r.outcome = 'OUT'
  AND r.result  = 'L';

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
-- vMundialitoRunBalls — cada mundialito, con sus partidos listos para pintar
-- -----------------------------------------------------------------------------
-- Una fila por corrida (terminada o en curso) con sus partidos armados como
-- JSON. Las dos vistas que siguen solo eligen cual mostrar: la vigente o la
-- mejor. El armado esta aca una sola vez porque son la misma tarjeta.
--
-- Cada pelota lleva de donde salio —fecha, diferencia con signo, equipo— para
-- que al pasar el mouse se pueda contar el partido sin ir a buscarlo. Esos tres
-- datos no viajan por el CTE recursivo: se cruzan despues contra
-- vMatchPlayerResults, que ya los tiene resueltos desde el punto de vista del
-- jugador.
--
-- El desenlace de la corrida es el del ultimo partido: los anteriores son todos
-- ALIVE por construccion.
CREATE OR REPLACE VIEW vMundialitoRunBalls AS
SELECT
  agg.playerId,
  agg.runIndex,
  agg.played,
  agg.groupPoints,
  agg.points,
  agg.status,
  agg.firstPlayedAt,
  agg.lastPlayedAt,
  -- Puesto que va a ocupar el proximo partido: el que sigue si esta vivo, y el
  -- 1 del mundialito nuevo si la corrida ya cerro.
  CAST(CASE WHEN agg.status = 'ALIVE' THEN agg.played + 1 ELSE 1 END AS SIGNED) AS nextSlot,
  -- Fase en la que quedo la corrida: la del ultimo partido jugado.
  CASE
    WHEN agg.played <= 3 THEN 'GROUP'
    WHEN agg.played = 4  THEN 'R16'
    WHEN agg.played = 5  THEN 'R8'
    WHEN agg.played = 6  THEN 'R4'
    WHEN agg.played = 7  THEN 'SF'
    ELSE 'F'
  END AS phase,
  balls.balls
FROM (
  SELECT
    r.playerId,
    r.runIndex,
    CAST(COUNT(*)         AS SIGNED) AS played,
    CAST(MAX(r.groupPoints) AS SIGNED) AS groupPoints,
    CAST(SUM(r.points)    AS SIGNED) AS points,
    MIN(r.playedAt)                  AS firstPlayedAt,
    MAX(r.playedAt)                  AS lastPlayedAt,
    SUBSTRING_INDEX(
      GROUP_CONCAT(r.outcome ORDER BY r.slot DESC SEPARATOR ','), ',', 1
    ) AS status
  FROM vMundialitoRuns r
  GROUP BY r.playerId, r.runIndex
) agg
LEFT JOIN (
  SELECT
    ordered.playerId,
    ordered.runIndex,
    JSON_ARRAYAGG(
      JSON_OBJECT(
        'slot',           ordered.slot,
        'phase',          ordered.phase,
        'result',         ordered.result,
        'points',         ordered.points,
        'matchId',        ordered.matchId,
        -- Formateada a mano y no como DATETIME: adentro de un JSON la fecha no
        -- pasa por el typeCast del pool, asi que saldria "2026-04-06 12:00:00",
        -- que Safari no parsea. Este es el mismo ISO con Z que produce el
        -- typeCast para las columnas de fecha normales.
        'playedAt',       DATE_FORMAT(ordered.playedAt, '%Y-%m-%dT%H:%i:%sZ'),
        'goalsDiference', ordered.goalsDiference,
        'team',           ordered.team
      )
    ) AS balls
  FROM (
    SELECT
      r.playerId, r.runIndex, r.slot, r.phase, r.result, r.points, r.matchId,
      r.playedAt,
      m.goalsDiference,
      m.team
    FROM vMundialitoRuns r
    INNER JOIN vMatchPlayerResults m
      ON m.playerId = r.playerId
     AND m.matchId  = r.matchId
    ORDER BY r.playerId, r.runIndex, r.slot
  ) ordered
  GROUP BY ordered.playerId, ordered.runIndex
) balls
  ON balls.playerId = agg.playerId
 AND balls.runIndex = agg.runIndex;

-- -----------------------------------------------------------------------------
-- vMundialitoCurrent — el mundialito vigente de cada jugador
-- -----------------------------------------------------------------------------
-- Vigente es el de mayor runIndex, este abierto o cerrado: un jugador que quedo
-- eliminado sigue mostrando ESA corrida —con su pelota roja— hasta que juegue
-- otro partido y arranque la siguiente. Lo mismo el campeon.
CREATE OR REPLACE VIEW vMundialitoCurrent AS
SELECT b.*
FROM vMundialitoRunBalls b
INNER JOIN (
  SELECT playerId, MAX(runIndex) AS runIndex
  FROM vMundialitoRunBalls
  GROUP BY playerId
) last
  ON last.playerId = b.playerId
 AND last.runIndex = b.runIndex;

-- -----------------------------------------------------------------------------
-- vMundialitoBestRun — el mejor mundialito que corrio cada jugador
-- -----------------------------------------------------------------------------
-- Mejor es, en este orden: haberlo ganado, haber llegado mas lejos, y haber
-- sacado mas puntos en el camino.
--
-- El titulo va primero y no despues de la cantidad de partidos porque una final
-- perdida tambien llega a ocho: sin esa prioridad, un subcampeon con siete
-- victorias le ganaria al campeon que empato dos en el camino, y "mi mejor
-- mundialito" pasaria a ser uno que perdio.
--
-- Entra tambien la corrida en curso: si el mejor que hizo es el que esta
-- jugando ahora, esa es la respuesta honesta.
CREATE OR REPLACE VIEW vMundialitoBestRun AS
SELECT
  ranked.playerId,
  ranked.runIndex,
  ranked.played,
  ranked.groupPoints,
  ranked.points,
  ranked.status,
  ranked.firstPlayedAt,
  ranked.lastPlayedAt,
  ranked.nextSlot,
  ranked.phase,
  ranked.balls
FROM (
  SELECT
    b.*,
    ROW_NUMBER() OVER (
      PARTITION BY b.playerId
      ORDER BY (b.status = 'CHAMPION') DESC, b.played DESC, b.points DESC,
               b.runIndex DESC
    ) AS rn
  FROM vMundialitoRunBalls b
) ranked
WHERE ranked.rn = 1;

-- =============================================================================
-- RACHAS
-- =============================================================================
-- Cuantos partidos seguidos lleva alguien sin perder, o sin ganar. Es de lo que
-- mas se habla en el grupo y no sale de ninguna suma: hay que reconocer tramos
-- consecutivos dentro del historial de cada jugador.
--
-- Se resuelve con el truco de "islas": dos numeraciones sobre la misma
-- secuencia —una global y otra que solo cuenta las filas del tipo buscado— y su
-- resta, que se mantiene constante mientras la racha no se corta. Agrupando por
-- esa diferencia, cada grupo es una racha.
--
-- A diferencia del mundialito, aca cuentan TODOS los partidos, incluidos los de
-- torneos sin detalle: estas rachas acompanian a la tabla historica, que
-- tambien los cuenta.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- vPlayerStreakIslands — cada tramo consecutivo, de los cuatro tipos
-- -----------------------------------------------------------------------------
-- kind:
--   UNBEATEN  partidos seguidos sin perder
--   WIN       victorias seguidas
--   WINLESS   partidos seguidos sin ganar
--   LOSS      derrotas seguidas
--
-- lastN e isOpen son lo que permite saber si la racha sigue viva: una racha
-- esta abierta si su ultimo partido es el ultimo que jugo esa persona.
CREATE OR REPLACE VIEW vPlayerStreakIslands AS
WITH seq AS (
  SELECT
    r.playerId,
    r.playedAt,
    r.matchId,
    r.result,
    ROW_NUMBER() OVER (PARTITION BY r.playerId ORDER BY r.playedAt, r.matchId) AS n,
    ROW_NUMBER() OVER (
      PARTITION BY r.playerId, r.result <> 'L' ORDER BY r.playedAt, r.matchId
    ) AS nUnbeaten,
    ROW_NUMBER() OVER (
      PARTITION BY r.playerId, r.result =  'W' ORDER BY r.playedAt, r.matchId
    ) AS nWin,
    ROW_NUMBER() OVER (
      PARTITION BY r.playerId, r.result <> 'W' ORDER BY r.playedAt, r.matchId
    ) AS nWinless,
    ROW_NUMBER() OVER (
      PARTITION BY r.playerId, r.result =  'L' ORDER BY r.playedAt, r.matchId
    ) AS nLoss
  FROM vMatchPlayerResults r
),
totals AS (
  SELECT playerId, MAX(n) AS lastMatch FROM seq GROUP BY playerId
),
islands AS (
  SELECT playerId, 'UNBEATEN' AS kind, n - nUnbeaten AS island, n, playedAt
  FROM seq WHERE result <> 'L'
  UNION ALL
  SELECT playerId, 'WIN', n - nWin, n, playedAt
  FROM seq WHERE result = 'W'
  UNION ALL
  SELECT playerId, 'WINLESS', n - nWinless, n, playedAt
  FROM seq WHERE result <> 'W'
  UNION ALL
  SELECT playerId, 'LOSS', n - nLoss, n, playedAt
  FROM seq WHERE result = 'L'
)
SELECT
  i.playerId,
  i.kind,
  CAST(COUNT(*) AS SIGNED) AS length,
  MIN(i.playedAt)          AS startedAt,
  MAX(i.playedAt)          AS endedAt,
  CAST(MAX(i.n) = MAX(t.lastMatch) AS SIGNED) AS isOpen
FROM islands i
INNER JOIN totals t ON t.playerId = i.playerId
GROUP BY i.playerId, i.kind, i.island;

-- -----------------------------------------------------------------------------
-- vPlayerStreaks — el resumen de rachas de cada jugador
-- -----------------------------------------------------------------------------
-- Las "actuales" son las rachas abiertas: la invicta y la que va sin ganar. Las
-- dos pueden estar abiertas a la vez —despues de un empate, alguien lleva tres
-- sin perder y dos sin ganar— y por eso viajan las dos; que se muestre una u
-- otra es decision de la pantalla.
CREATE OR REPLACE VIEW vPlayerStreaks AS
SELECT
  p.playerId,
  COALESCE(best.bestUnbeaten, 0)     AS bestUnbeaten,
  best.bestUnbeatenEndedAt,
  COALESCE(best.bestWin, 0)          AS bestWin,
  best.bestWinEndedAt,
  COALESCE(best.worstWinless, 0)     AS worstWinless,
  COALESCE(best.worstLoss, 0)        AS worstLoss,
  COALESCE(open.currentUnbeaten, 0)  AS currentUnbeaten,
  COALESCE(open.currentWinless, 0)   AS currentWinless
FROM Players p
LEFT JOIN (
  SELECT
    s.playerId,
    CAST(MAX(CASE WHEN s.kind = 'UNBEATEN' THEN s.length END) AS SIGNED) AS bestUnbeaten,
    CAST(MAX(CASE WHEN s.kind = 'WIN'      THEN s.length END) AS SIGNED) AS bestWin,
    CAST(MAX(CASE WHEN s.kind = 'WINLESS'  THEN s.length END) AS SIGNED) AS worstWinless,
    CAST(MAX(CASE WHEN s.kind = 'LOSS'     THEN s.length END) AS SIGNED) AS worstLoss,
    -- La fecha del final de la mejor racha de cada tipo. El SUBSTRING_INDEX
    -- sobre un GROUP_CONCAT ordenado es la forma de traer "el valor de la fila
    -- que tiene el maximo" sin una segunda pasada.
    --
    -- Sale formateada como ISO con Z porque GROUP_CONCAT devuelve texto: el
    -- typeCast del pool solo convierte columnas DATETIME, y esta ya no lo es.
    SUBSTRING_INDEX(GROUP_CONCAT(
      CASE WHEN s.kind = 'UNBEATEN'
           THEN DATE_FORMAT(s.endedAt, '%Y-%m-%dT%H:%i:%sZ') END
      ORDER BY CASE WHEN s.kind = 'UNBEATEN' THEN s.length ELSE 0 END DESC, s.endedAt DESC
      SEPARATOR ','), ',', 1) AS bestUnbeatenEndedAt,
    SUBSTRING_INDEX(GROUP_CONCAT(
      CASE WHEN s.kind = 'WIN'
           THEN DATE_FORMAT(s.endedAt, '%Y-%m-%dT%H:%i:%sZ') END
      ORDER BY CASE WHEN s.kind = 'WIN' THEN s.length ELSE 0 END DESC, s.endedAt DESC
      SEPARATOR ','), ',', 1) AS bestWinEndedAt
  FROM vPlayerStreakIslands s
  GROUP BY s.playerId
) best ON best.playerId = p.playerId
LEFT JOIN (
  SELECT
    s.playerId,
    CAST(MAX(CASE WHEN s.kind = 'UNBEATEN' THEN s.length END) AS SIGNED) AS currentUnbeaten,
    CAST(MAX(CASE WHEN s.kind = 'WINLESS'  THEN s.length END) AS SIGNED) AS currentWinless
  FROM vPlayerStreakIslands s
  WHERE s.isOpen = 1
  GROUP BY s.playerId
) open ON open.playerId = p.playerId;

-- =============================================================================
-- ASISTENCIA
-- =============================================================================
-- La base guarda quien jugo, nunca quien falto. La ausencia hay que deducirla:
-- hubo partido, vos no estabas.
--
-- Apoya en un supuesto del grupo: cuando se juega, juegan todos los que fueron,
-- repartidos en los dos equipos. Por eso no figurar en la convocatoria es haber
-- faltado. Hay un partido cargado con una sola formacion, y ahi medio plantel
-- figura como ausente: es un dato incompleto conocido.
--
-- Se excluyen los torneos wasTracked = FALSE. De esos solo sobrevivio la tabla
-- y sus partidos son reconstrucciones: contarlos inventaria ausencias que nadie
-- tuvo.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- vPlayerAttendance — presente o ausente en cada partido, desde el debut
-- -----------------------------------------------------------------------------
-- La ventana de cada jugador arranca en su primer partido y llega hasta hoy: el
-- que se fue del grupo sigue acumulando ausencias, que es justamente el chiste
-- de "Se busca!".
CREATE OR REPLACE VIEW vPlayerAttendance AS
WITH tracked AS (
  SELECT m.matchId, m.playedAt
  FROM Matches m
  INNER JOIN Tournaments t ON t.tournamentId = m.tournamentId
  WHERE t.wasTracked = TRUE
),
debut AS (
  SELECT mp.playerId, MIN(tr.playedAt) AS debutAt
  FROM MatchPlayers mp
  INNER JOIN tracked tr ON tr.matchId = mp.matchId
  GROUP BY mp.playerId
)
SELECT
  d.playerId,
  tr.matchId,
  tr.playedAt,
  CAST(mp.playerId IS NOT NULL AS SIGNED) AS present,
  CAST(ROW_NUMBER() OVER (
    PARTITION BY d.playerId ORDER BY tr.playedAt, tr.matchId
  ) AS SIGNED) AS n
FROM debut d
INNER JOIN tracked tr
  ON tr.playedAt >= d.debutAt
LEFT JOIN MatchPlayers mp
  ON mp.matchId  = tr.matchId
 AND mp.playerId = d.playerId;

-- -----------------------------------------------------------------------------
-- vPlayerAttendanceStreaks — la racha mas larga de cada tipo
-- -----------------------------------------------------------------------------
-- Mismo truco de islas que vPlayerStreakIslands: la diferencia entre la
-- numeracion global y la numeracion dentro del tipo se mantiene constante
-- mientras la racha no se corta, asi que agrupar por esa diferencia da los
-- tramos.
CREATE OR REPLACE VIEW vPlayerAttendanceStreaks AS
SELECT
  i.playerId,
  CAST(COALESCE(MAX(CASE WHEN i.present = 1 THEN i.length END), 0) AS SIGNED) AS bestAttendanceStreak,
  CAST(COALESCE(MAX(CASE WHEN i.present = 0 THEN i.length END), 0) AS SIGNED) AS bestAbsenceStreak
FROM (
  SELECT marked.playerId, marked.present, COUNT(*) AS length
  FROM (
    SELECT
      a.playerId,
      a.present,
      a.n - ROW_NUMBER() OVER (
        PARTITION BY a.playerId, a.present ORDER BY a.n
      ) AS island
    FROM vPlayerAttendance a
  ) marked
  GROUP BY marked.playerId, marked.present, marked.island
) i
GROUP BY i.playerId;

-- =============================================================================
-- POSICIONES FECHA A FECHA
-- =============================================================================
-- La tabla de un torneo despues de cada fecha, no solo al final. La necesitan
-- dos logros: Pechofrio (liderar 5 fechas y no ganarlo) y Puro Huevo (ganarlo
-- sin haber liderado hasta la ultima).
--
-- Una fecha es cada partido del torneo: en este grupo se juega un partido por
-- dia y van todos los que van.
--
-- La penalizacion se resta completa desde la primera fecha. PlayerPenalties no
-- guarda cuando se aplico, asi que repartirla en el tiempo seria inventar un
-- dato; restarla entera tiene ademas la ventaja de que la ultima fecha coincide
-- exactamente con vTournamentStandings. El costo asumido es que un penalizado
-- aparece castigado desde el principio.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- vTournamentMatchdays — las fechas de cada torneo, numeradas
-- -----------------------------------------------------------------------------
-- matchdays (el total) viaja en cada fila para que "es la ultima fecha" se
-- pueda preguntar sin un segundo join.
CREATE OR REPLACE VIEW vTournamentMatchdays AS
SELECT
  m.tournamentId,
  m.matchId,
  m.playedAt,
  CAST(ROW_NUMBER() OVER (
    PARTITION BY m.tournamentId ORDER BY m.playedAt, m.matchId
  ) AS SIGNED) AS matchday,
  CAST(COUNT(*) OVER (PARTITION BY m.tournamentId) AS SIGNED) AS matchdays
FROM Matches m;

-- -----------------------------------------------------------------------------
-- vTournamentMatchdayStandings — la tabla acumulada tras cada fecha
-- -----------------------------------------------------------------------------
-- Cada jugador del torneo aparece en TODAS las fechas, haya jugado esa o no:
-- el que falta no desaparece de la tabla, se queda con los puntos que tenia.
-- Por eso el cruce entre las fechas y el plantel del torneo antes del LEFT JOIN
-- contra los resultados.
--
-- OJO con el CASE de puntos: no alcanza con hacer CASE played.result, porque
-- cuando el LEFT JOIN no encuentra partido (todavia no debuto para esta fecha)
-- played.result es NULL, y un CASE simple sobre NULL no matchea ni 'W' ni 'D'
-- y cae en el ELSE. Sin el WHEN explicito de played.matchId IS NULL, "no jugo
-- todavia" se contaba como derrota y sumaba lossingPoints de regalo.
--
-- El join es triangular (cada fecha suma todos los partidos anteriores o igual)
-- y con quince fechas y quince jugadores eso son un par de miles de filas por
-- torneo: no hace falta nada mas astuto.
CREATE OR REPLACE VIEW vTournamentMatchdayStandings AS
SELECT
  b.tournamentId,
  b.matchday,
  b.matchdays,
  b.playerId,
  b.points,
  b.goalsDiference,
  b.netPoints,
  b.winRate,
  CAST(ROW_NUMBER() OVER (
    PARTITION BY b.tournamentId, b.matchday
    ORDER BY b.netPoints DESC, b.goalsDiference DESC, b.winRate DESC, b.playerId ASC
  ) AS SIGNED) AS `position`
FROM (
  SELECT
    grid.tournamentId,
    grid.matchday,
    grid.matchdays,
    grid.playerId,
    COALESCE(SUM(
      CASE
        WHEN played.matchId IS NULL THEN 0
        WHEN played.result = 'W'    THEN t.winningPoints
        WHEN played.result = 'D'    THEN t.drawingPoints
        ELSE                             t.lossingPoints
      END), 0)                                              AS points,
    CAST(COALESCE(SUM(played.goalsDiference), 0) AS SIGNED) AS goalsDiference,
    COALESCE(SUM(
      CASE
        WHEN played.matchId IS NULL THEN 0
        WHEN played.result = 'W'    THEN t.winningPoints
        WHEN played.result = 'D'    THEN t.drawingPoints
        ELSE                             t.lossingPoints
      END), 0) - COALESCE(pp.penalty, 0)                    AS netPoints,
    CASE WHEN COUNT(played.matchId) > 0
         THEN COALESCE(SUM(
                CASE
                  WHEN played.matchId IS NULL THEN 0
                  WHEN played.result = 'W'    THEN t.winningPoints
                  WHEN played.result = 'D'    THEN t.drawingPoints
                  ELSE                             t.lossingPoints
                END), 0) / (t.winningPoints * COUNT(played.matchId))
    END                                                     AS winRate
  FROM (
    SELECT md.tournamentId, md.matchday, md.matchdays, md.playedAt, md.matchId, ro.playerId
    FROM vTournamentMatchdays md
    INNER JOIN (
      SELECT DISTINCT tournamentId, playerId FROM MatchPlayers
    ) ro ON ro.tournamentId = md.tournamentId
  ) grid
  INNER JOIN Tournaments t
    ON t.tournamentId = grid.tournamentId
  LEFT JOIN PlayerPenalties pp
    ON pp.tournamentId = grid.tournamentId
   AND pp.playerId     = grid.playerId
  LEFT JOIN (
    SELECT r.playerId, r.matchId, r.result, r.goalsDiference, md.tournamentId, md.matchday
    FROM vMatchPlayerResults r
    INNER JOIN vTournamentMatchdays md ON md.matchId = r.matchId
  ) played
    ON played.tournamentId = grid.tournamentId
   AND played.playerId     = grid.playerId
   AND played.matchday    <= grid.matchday
  GROUP BY grid.tournamentId, grid.matchday, grid.matchdays, grid.playerId,
           t.winningPoints, pp.penalty
) b;

-- -----------------------------------------------------------------------------
-- vPlayerGoalDiffPeaks — hasta donde llego la diferencia acumulada
-- -----------------------------------------------------------------------------
-- La diferencia de gol de un jugador sube y baja toda la vida. Un logro que
-- dijera "tene +50 hoy" se prenderia y se apagaria; lo que se guarda aca es el
-- punto mas alto y el mas bajo que toco la cuenta en toda su carrera, y eso
-- solo puede crecer.
--
-- GREATEST y LEAST contra 0 evitan el caso raro del que siempre estuvo en
-- negativo: su "pico" es 0, no su mejor momento negativo.
CREATE OR REPLACE VIEW vPlayerGoalDiffPeaks AS
SELECT
  s.playerId,
  CAST(GREATEST(MAX(s.running), 0) AS SIGNED) AS peakGoalDiff,
  CAST(LEAST(MIN(s.running), 0)    AS SIGNED) AS floorGoalDiff
FROM (
  SELECT
    r.playerId,
    SUM(r.goalsDiference) OVER (
      PARTITION BY r.playerId
      ORDER BY r.playedAt, r.matchId
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS running
  FROM vMatchPlayerResults r
) s
GROUP BY s.playerId;

-- =============================================================================
-- LOGROS
-- =============================================================================
-- Los logros no se guardan: se deducen del historial cada vez que alguien abre
-- la solapa. La regla "una vez obtenido, nunca se vuelve atras" se cumple sola
-- porque cada condicion esta escrita como hecho historico —"alguna vez paso
-- X"— y el historial nunca se achica.
--
-- Las dos unicas excepciones son Mexicano y Eterno Candidato: son maldiciones,
-- y se rompen cuando el jugador mejora. Ese estado tiene su propio valor ('B').
-- =============================================================================

-- -----------------------------------------------------------------------------
-- vPlayerAchievementFacts — los numeros crudos que miran las reglas
-- -----------------------------------------------------------------------------
-- Una fila por jugador, con TODOS los jugadores: el que no jugo nunca aparece
-- con ceros, para que su solapa abra igual con las 28 en gris.
--
-- Cada LEFT JOIN resuelve una familia de hechos. Ninguno aplica umbrales: eso
-- es trabajo de vPlayerAchievements. Aca solo se cuenta.
--
-- Sobre el torneo 2024 (wasTracked = FALSE): sus cinco partidos son sinteticos
-- y tienen diferencia de gol 0, asi que no disparan ninguna goleada. Las rachas
-- si los cuentan, porque salen de vPlayerStreaks, que es el mismo numero que el
-- perfil ya publica: si el perfil dice "mejor racha 11", la medalla de 10 no
-- puede estar en gris. La asistencia y el mundialito los excluyen por su cuenta.
CREATE OR REPLACE VIEW vPlayerAchievementFacts AS
SELECT
  p.playerId,

  -- Partidos sueltos
  COALESCE(mar.maxWinMargin, 0)          AS maxWinMargin,
  COALESCE(mar.maxLossMargin, 0)         AS maxLossMargin,

  -- Superclasicos
  COALESCE(der.derbiesPlayed, 0)         AS derbiesPlayed,
  COALESCE(der.maxDerbyWinMargin, 0)     AS maxDerbyWinMargin,
  COALESCE(der.maxDerbyLossMargin, 0)    AS maxDerbyLossMargin,

  -- Posiciones en torneos finalizados
  COALESCE(pos.championships, 0)         AS championships,
  COALESCE(pos.runnerUps, 0)             AS runnerUps,
  COALESCE(pos.bottomTwo, 0)             AS bottomTwo,
  COALESCE(pos.thirdFromBottom, 0)       AS thirdFromBottom,

  -- Acumulados de la tabla historica
  COALESCE(gen.played, 0)                AS played,
  COALESCE(gen.drew, 0)                  AS draws,
  COALESCE(gen.points, 0)                AS points,

  -- Rachas y picos
  COALESCE(str.bestWin, 0)               AS bestWinStreak,
  COALESCE(str.worstLoss, 0)             AS worstLossStreak,
  COALESCE(pk.peakGoalDiff, 0)           AS peakGoalDiff,
  COALESCE(pk.floorGoalDiff, 0)          AS floorGoalDiff,
  COALESCE(att.bestAttendanceStreak, 0)  AS bestAttendanceStreak,
  COALESCE(att.bestAbsenceStreak, 0)     AS bestAbsenceStreak,

  -- Liderazgos fecha a fecha
  COALESCE(led.leadMatchdaysWithoutTitle, 0) AS leadMatchdaysWithoutTitle,
  COALESCE(cmb.comebackTitles, 0)        AS comebackTitles,

  -- Mundialito
  COALESCE(mst.titles, 0)                AS mundialitoTitles,
  COALESCE(mst.perfectRuns, 0)           AS perfectRuns,
  COALESCE(mst.semis, 0)                 AS semiRuns,
  COALESCE(mst.bestSlot, 0)              AS bestSlot,
  COALESCE(mrun.unbeatenTitles, 0)       AS unbeatenTitles,
  COALESCE(mrun.shortRuns, 0)            AS shortRuns,
  COALESCE(mrun.groupZeroRuns, 0)        AS groupZeroRuns,
  COALESCE(fin.maxFinalWinMargin, 0)     AS maxFinalWinMargin,
  COALESCE(fin.maxFinalLossMargin, 0)    AS maxFinalLossMargin
FROM Players p

-- La goleada mas grande a favor y en contra. maxLossMargin va en positivo: es
-- una magnitud, y asi el umbral del logro se lee igual que el del otro.
LEFT JOIN (
  SELECT
    r.playerId,
    CAST(GREATEST(MAX(r.goalsDiference), 0)  AS SIGNED) AS maxWinMargin,
    CAST(GREATEST(-MIN(r.goalsDiference), 0) AS SIGNED) AS maxLossMargin
  FROM vMatchPlayerResults r
  GROUP BY r.playerId
) mar ON mar.playerId = p.playerId

LEFT JOIN (
  SELECT
    r.playerId,
    CAST(COUNT(*)                            AS SIGNED) AS derbiesPlayed,
    CAST(GREATEST(MAX(r.goalsDiference), 0)  AS SIGNED) AS maxDerbyWinMargin,
    CAST(GREATEST(-MIN(r.goalsDiference), 0) AS SIGNED) AS maxDerbyLossMargin
  FROM vMatchPlayerResults r
  WHERE r.isDerby = TRUE
  GROUP BY r.playerId
) der ON der.playerId = p.playerId

-- Ultimo, penultimo y antepenultimo necesitan saber cuantos jugaron el torneo.
-- El minimo de cinco evita repartir un descenso en un torneo de tres.
LEFT JOIN (
  SELECT
    st.playerId,
    CAST(SUM(st.`position` = 1) AS SIGNED) AS championships,
    CAST(SUM(st.`position` = 2) AS SIGNED) AS runnerUps,
    CAST(SUM(cnt.players >= 5 AND st.`position` >= cnt.players - 1) AS SIGNED) AS bottomTwo,
    CAST(SUM(cnt.players >= 5 AND st.`position`  = cnt.players - 2) AS SIGNED) AS thirdFromBottom
  FROM vTournamentStandings st
  INNER JOIN Tournaments t
    ON t.tournamentId = st.tournamentId
   AND t.state        = 'F'
  INNER JOIN (
    SELECT tournamentId, CAST(COUNT(*) AS SIGNED) AS players
    FROM vTournamentStandings
    GROUP BY tournamentId
  ) cnt ON cnt.tournamentId = st.tournamentId
  GROUP BY st.playerId
) pos ON pos.playerId = p.playerId

-- Puntos BRUTOS, no netos: los netos bajan cuando llega una penalizacion y
-- Coleccionista dejaria de ser un logro historico.
--
-- points es el unico hecho que NO va casteado a SIGNED: la puntuacion del
-- torneo es DOUBLE y la Clausura paga 0.25 por perder, asi que el cast se
-- comeria los cuartos de punto.
LEFT JOIN vGeneralScoreboard gen ON gen.playerId = p.playerId

LEFT JOIN vPlayerStreaks       str ON str.playerId = p.playerId
LEFT JOIN vPlayerGoalDiffPeaks pk  ON pk.playerId  = p.playerId
LEFT JOIN vPlayerAttendanceStreaks att ON att.playerId = p.playerId

-- Pechofrio: de los torneos finalizados que NO gano, en cuantas fechas de uno
-- solo estuvo primero. Es un maximo por torneo, no una suma entre torneos.
--
-- El alias va entre backticks porque LEAD es palabra reservada en MySQL 8: sin
-- ellos la vista no compila.
LEFT JOIN (
  SELECT `lead`.playerId, CAST(MAX(`lead`.matchdaysLed) AS SIGNED) AS leadMatchdaysWithoutTitle
  FROM (
    SELECT ms.playerId, ms.tournamentId, COUNT(*) AS matchdaysLed
    FROM vTournamentMatchdayStandings ms
    INNER JOIN Tournaments t
      ON t.tournamentId = ms.tournamentId
     AND t.state        = 'F'
    LEFT JOIN vTournamentChampions c
      ON c.tournamentId = ms.tournamentId
     AND c.playerId     = ms.playerId
    WHERE ms.`position` = 1
      AND c.playerId IS NULL
    GROUP BY ms.playerId, ms.tournamentId
  ) `lead`
  GROUP BY `lead`.playerId
) led ON led.playerId = p.playerId

-- Puro Huevo: torneos ganados sin haber estado primero en ninguna fecha
-- anterior a la ultima.
--
-- La pregunta se responde con un solo numero: cual fue la PRIMERA fecha en la
-- que el campeon aparecio primero. Si esa fecha es la ultima, no lidero antes y
-- el titulo es una remontada. Sacar ese numero afuera —en vez de esconder la
-- regla en un NOT EXISTS correlacionado— deja el hecho reducido a una igualdad
-- entre dos enteros que el verificador puede comparar por separado, que es lo
-- unico que se puede hacer con un hecho que hoy da cero para todos.
--
-- El INNER JOIN alcanza: el campeon lidera al menos la ultima fecha, siempre,
-- porque la ultima fecha de la tabla acumulada ES la tabla final del torneo.
LEFT JOIN (
  SELECT c.playerId, CAST(SUM(fl.firstLeadMatchday = fl.matchdays) AS SIGNED) AS comebackTitles
  FROM vTournamentChampions c
  INNER JOIN (
    SELECT
      ms.tournamentId,
      ms.playerId,
      MIN(ms.matchday)  AS firstLeadMatchday,
      MAX(ms.matchdays) AS matchdays
    FROM vTournamentMatchdayStandings ms
    WHERE ms.`position` = 1
    GROUP BY ms.tournamentId, ms.playerId
  ) fl
    ON fl.tournamentId = c.tournamentId
   AND fl.playerId     = c.playerId
  GROUP BY c.playerId
) cmb ON cmb.playerId = p.playerId

LEFT JOIN vMundialitoPlayerStats mst ON mst.playerId = p.playerId

-- Tres hechos que se miran por corrida entera y no por partido.
LEFT JOIN (
  SELECT
    run.playerId,
    CAST(SUM(run.isUnbeatenTitle) AS SIGNED) AS unbeatenTitles,
    CAST(SUM(run.isShort)         AS SIGNED) AS shortRuns,
    CAST(SUM(run.isGroupZero)     AS SIGNED) AS groupZeroRuns
  FROM (
    SELECT
      r.playerId,
      r.runIndex,
      -- Campeon sin perder ninguno de los ocho. Se puede dar la vuelta habiendo
      -- perdido en la fase de grupos, asi que invicto es un escalon mas.
      (MAX(r.outcome = 'CHAMPION') = 1 AND SUM(r.result = 'L') = 0) AS isUnbeatenTitle,
      -- Corrida TERMINADA que no llego al quinto partido.
      (MAX(r.outcome <> 'ALIVE') = 1 AND MAX(r.slot) <= 4)          AS isShort,
      -- Eliminado en grupos sin sumar un punto. Es lo que reemplaza al
      -- "perdiste los 3 de grupos" original, que no puede pasar: con dos
      -- derrotas la corrida se corta en el segundo partido.
      (MAX(r.outcome = 'OUT') = 1 AND MAX(r.slot) <= 3
                                  AND MAX(r.groupPoints) = 0)       AS isGroupZero
    FROM vMundialitoRuns r
    GROUP BY r.playerId, r.runIndex
  ) run
  GROUP BY run.playerId
) mrun ON mrun.playerId = p.playerId

-- Las finales, con la diferencia de gol que trae vMatchPlayerResults: el CTE
-- del mundialito no la lleva.
LEFT JOIN (
  SELECT
    r.playerId,
    CAST(COALESCE(MAX(CASE WHEN r.result = 'W' THEN  m.goalsDiference END), 0) AS SIGNED) AS maxFinalWinMargin,
    CAST(COALESCE(MAX(CASE WHEN r.result = 'L' THEN -m.goalsDiference END), 0) AS SIGNED) AS maxFinalLossMargin
  FROM vMundialitoRuns r
  INNER JOIN vMatchPlayerResults m
    ON m.playerId = r.playerId
   AND m.matchId  = r.matchId
  WHERE r.slot = 8
  GROUP BY r.playerId
) fin ON fin.playerId = p.playerId;

-- -----------------------------------------------------------------------------
-- vPlayerAchievements — el estado de cada logro, para cada jugador
-- -----------------------------------------------------------------------------
-- Una regla por renglon, todas con la misma forma: leer un hecho, compararlo con
-- un umbral y devolver el estado. Agregar un logro que use hechos que ya estan
-- calculados es agregar un renglon.
--
-- POR QUE LATERAL Y NO 28 UNION ALL: la version anterior repetia
-- `FROM vPlayerAchievementFacts` en cada una de las 28 ramas, y eso hacia que
-- los hechos se calcularan 28 veces. Leer la vista entera costaba 3,8s contra
-- los 0,13s que cuesta un solo pase por los hechos —3,8 dividido 28 da 0,13, la
-- cuenta cerraba exacta— y filtrar por un jugador no ayudaba en nada, porque el
-- filtro llega despues de las 28 evaluaciones.
--
-- Con LATERAL los hechos se escanean UNA sola vez y por cada fila se despliegan
-- los 28 logros. El UNION ALL de adentro no toca ninguna tabla: son 28 filas
-- constantes armadas con las columnas de f, y el plan las muestra como "Rows
-- fetched before execution", sin materializar nada. La vista entera pasa a
-- costar 0,13s, lo mismo que los hechos solos, y filtrada por un jugador
-- tambien. La propiedad de un renglon por regla se conserva, que era el punto.
--
-- EL CAST A CHAR(24) FIJA EL CONTRATO, NO EVITA UN TRUNCAMIENTO: en un UNION
-- ALL no recursivo (como este) MySQL toma el ancho de la rama MAS LARGA de
-- TODAS, asi que sin el CAST 'BUSCATE_UN_LABURO' hubiera ensanchado la columna
-- a 17 sola, sin perder nada. El que si trunca es otro caso: una CTE
-- RECURSIVA, donde el ancho lo fija solo la rama no recursiva del ancla -eso
-- es lo que le paso a 'CHAMPION' en vMundialitoRuns-. El CAST igual conviene:
-- es un piso, no un techo (si el dia de manana una rama trae un code de 30
-- caracteres, la columna se ensancha a 30 sola), y deja el contrato de salida
-- explicito en vez de heredado de cual rama se haya escrito primero.
--
-- progress / target son NULL en los logros de evento -salir campeon no tiene
-- media medalla- y el frontend no les dibuja barra.
--
-- Estados: 'U' obtenido, 'L' bloqueado, 'B' roto.
--
-- Nota MySQL 8.4 (bugs.mysql.com/112704): repetir `FROM vPlayerAchievementFacts`
-- en 28 ramas separadas disparaba un bug del motor TempTable ("Table
-- './tmp/#sql...' doesn't exist"). LATERAL ya no lo dispara porque evalua los
-- hechos una sola vez; si esta vista vuelve a escribirse repitiendo esa
-- evaluacion por rama, puede reaparecer.
CREATE OR REPLACE VIEW vPlayerAchievements AS
SELECT f.playerId, r.code, r.state, r.progress, r.target
FROM vPlayerAchievementFacts f,
LATERAL (
  SELECT CAST('CAZADOR' AS CHAR(24)) AS code,
         CASE WHEN f.maxWinMargin >= 10 THEN 'U' ELSE 'L' END AS state,
         CAST(f.maxWinMargin AS SIGNED) AS progress, CAST(10 AS SIGNED) AS target
  UNION ALL SELECT 'LA_CAMA',
         CASE WHEN f.maxLossMargin >= 10 THEN 'U' ELSE 'L' END, f.maxLossMargin, 10
  UNION ALL SELECT 'CORONADOS',
         CASE WHEN f.championships >= 1 THEN 'U' ELSE 'L' END, NULL, NULL
  UNION ALL SELECT 'PRIMER_PERDEDOR',
         CASE WHEN f.runnerUps >= 1 THEN 'U' ELSE 'L' END, NULL, NULL
  UNION ALL SELECT 'ESTAMOS_EN_LA_B',
         CASE WHEN f.bottomTwo >= 1 THEN 'U' ELSE 'L' END, NULL, NULL
  UNION ALL SELECT 'LA_PROMOCION',
         CASE WHEN f.thirdFromBottom >= 1 THEN 'U' ELSE 'L' END, NULL, NULL
  UNION ALL SELECT 'MANO_A_MANO',
         CASE WHEN f.draws >= 10 THEN 'U' ELSE 'L' END, f.draws, 10
  UNION ALL SELECT 'EL_CORNUDO',
         CASE WHEN f.bestWinStreak >= 10 THEN 'U' ELSE 'L' END, f.bestWinStreak, 10
  UNION ALL SELECT 'DEJALO_AMIGO',
         CASE WHEN f.worstLossStreak >= 10 THEN 'U' ELSE 'L' END, f.worstLossStreak, 10
  UNION ALL SELECT 'COLECCIONISTA',
         CASE WHEN f.points >= 100 THEN 'U' ELSE 'L' END, FLOOR(f.points), 100
  UNION ALL SELECT 'PERRO_VIEJO',
         CASE WHEN f.played >= 50 THEN 'U' ELSE 'L' END, f.played, 50
  UNION ALL SELECT 'BUSCATE_UN_LABURO',
         CASE WHEN f.bestAttendanceStreak >= 20 THEN 'U' ELSE 'L' END, f.bestAttendanceStreak, 20
  UNION ALL SELECT 'SE_BUSCA',
         CASE WHEN f.bestAbsenceStreak >= 10 THEN 'U' ELSE 'L' END, f.bestAbsenceStreak, 10
  UNION ALL SELECT 'PICHICHI',
         CASE WHEN f.peakGoalDiff >= 50 THEN 'U' ELSE 'L' END, f.peakGoalDiff, 50
  -- El unico con umbral negativo: el progreso viaja en positivo para que la
  -- barra del frontend no tenga que saber de signos.
  UNION ALL SELECT 'PICHI',
         CASE WHEN f.floorGoalDiff <= -50 THEN 'U' ELSE 'L' END, -f.floorGoalDiff, 50
  UNION ALL SELECT 'PECHOFRIO',
         CASE WHEN f.leadMatchdaysWithoutTitle >= 5 THEN 'U' ELSE 'L' END, f.leadMatchdaysWithoutTitle, 5
  UNION ALL SELECT 'PURO_HUEVO',
         CASE WHEN f.comebackTitles >= 1 THEN 'U' ELSE 'L' END, NULL, NULL
  UNION ALL SELECT 'EX_EQUIPO',
         CASE WHEN f.maxDerbyLossMargin >= 7 THEN 'U' ELSE 'L' END, f.maxDerbyLossMargin, 7
  UNION ALL SELECT 'HERMOSA_MANIANA',
         CASE WHEN f.maxDerbyWinMargin >= 7 THEN 'U' ELSE 'L' END, f.maxDerbyWinMargin, 7
  UNION ALL SELECT 'LEYENDA',
         CASE WHEN f.derbiesPlayed >= 8 THEN 'U' ELSE 'L' END, f.derbiesPlayed, 8
  UNION ALL SELECT 'CAMPEON_DEL_MUNDO',
         CASE WHEN f.mundialitoTitles >= 1 THEN 'U' ELSE 'L' END, NULL, NULL
  UNION ALL SELECT 'JUEGUEN_ENSERIO',
         CASE WHEN f.unbeatenTitles >= 1 THEN 'U' ELSE 'L' END, NULL, NULL
  UNION ALL SELECT 'INVENTEN_DEPORTE',
         CASE WHEN f.perfectRuns >= 1 THEN 'U' ELSE 'L' END, NULL, NULL
  -- Maldicion: llegar al quinto partido una sola vez la rompe para siempre, haya
  -- alcanzado o no las cinco corridas cortas.
  UNION ALL SELECT 'MEXICANO',
         CASE WHEN f.bestSlot >= 5 THEN 'B'
              WHEN f.shortRuns >= 5 THEN 'U'
              ELSE 'L' END, f.shortRuns, 5
  -- Maldicion: la primera copa deja de ser candidato para siempre.
  UNION ALL SELECT 'ETERNO_CANDIDATO',
         CASE WHEN f.mundialitoTitles >= 1 THEN 'B'
              WHEN f.semiRuns >= 4 THEN 'U'
              ELSE 'L' END, f.semiRuns, 4
  UNION ALL SELECT 'REPECHAJE',
         CASE WHEN f.groupZeroRuns >= 1 THEN 'U' ELSE 'L' END, NULL, NULL
  UNION ALL SELECT 'EZ',
         CASE WHEN f.maxFinalWinMargin >= 8 THEN 'U' ELSE 'L' END, f.maxFinalWinMargin, 8
  UNION ALL SELECT 'DIA_PARA_OLVIDO',
         CASE WHEN f.maxFinalLossMargin >= 8 THEN 'U' ELSE 'L' END, f.maxFinalLossMargin, 8
) r;
