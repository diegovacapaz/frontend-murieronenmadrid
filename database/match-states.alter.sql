-- =============================================================================
-- murieron-en-madrid — estados del partido (team maker)
-- =============================================================================
-- CORRER UNA SOLA VEZ. No es idempotente: un segundo ADD COLUMN falla.
--
-- Por que un ALTER y no un CREATE IF NOT EXISTS: Matches y MatchPlayers son del
-- esquema original. El default 'J' deja a todos los partidos ya cargados como
-- jugados, que es exactamente lo que son, asi que no hace falta backfill.
--
--   P = en preparacion: convocados sin equipo, no suma nada.
--   R = listo: equipos armados, sin resultado, no suma nada.
--   J = jugado: el unico estado que leen tablas, logros, mundialito y diario.
--
-- MatchPlayers.team pasa a NULL: un partido en preparacion tiene convocados
-- sin equipo. Que solo pueda ser NULL en partidos P lo validan los SPs, porque
-- un CHECK no puede mirar otra tabla.
-- =============================================================================

ALTER TABLE Matches
  ADD COLUMN state CHAR(1) NOT NULL DEFAULT 'J' AFTER isDerby,
  ADD KEY Matches_state_index (state),
  ADD CONSTRAINT Matches_state_check CHECK (state IN ('P', 'R', 'J'));

ALTER TABLE MatchPlayers
  MODIFY COLUMN team CHAR(1) NULL;
