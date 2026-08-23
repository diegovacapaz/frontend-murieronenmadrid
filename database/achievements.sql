-- =============================================================================
-- murieron-en-madrid — catalogo de logros
-- =============================================================================
-- Las filas de Achievements, en un archivo aparte para poder reaplicarlas sin
-- tocar el esquema:  node scripts/apply-sql.mjs achievements.sql
--
-- El DELETE de arriba lo hace idempotente. Es seguro: ninguna tabla referencia
-- Achievements, y el estado de cada jugador no se guarda en ningun lado.
--
-- sortOrder fija el orden de la grilla y agrupa por categoria: 100+ Generales,
-- 300+ Superclasicos, 400+ Mundialito. Los huecos de diez dejan lugar para
-- intercalar un logro nuevo sin renumerar los demas.
-- =============================================================================

-- Los titulos y las descripciones llevan tildes, enies y signos de apertura, y
-- este archivo esta guardado en UTF-8. El cliente `mysql` de la imagen oficial
-- abre la conexion en latin1, asi que sin esta linea los bytes entran mal y en
-- la base queda "UtopÃ­as". No alcanza con que la columna sea utf8mb4: lo que
-- falla es como se interpreta lo que llega. Pasa por el cliente y no por el
-- driver de Node, que ya se conecta en utf8mb4.
SET NAMES utf8mb4;

DELETE FROM Achievements;

INSERT INTO Achievements (code, category, title, description, isBreakable, sortOrder) VALUES
  ('CAZADOR',           'G', 'Cazador de Utopías Imposibles', 'Gana un partido por 10 goles o más',                    FALSE,  100),
  ('LA_CAMA',           'G', 'La Cama',                       'Pierde un partido por 10 goles o más',                  FALSE,  110),
  ('CORONADOS',         'G', 'Coronados de Gloria',           'Sal campeón',                                           FALSE,  120),
  ('PRIMER_PERDEDOR',   'G', 'El Primer Perdedor',            'Sal subcampeón',                                        FALSE,  130),
  ('ESTAMOS_EN_LA_B',   'G', '¡Estamos en la B!',             'Sal último o penúltimo',                                FALSE,  140),
  ('LA_PROMOCION',      'G', 'La Promoción',                  'Sal antepenúltimo',                                     FALSE,  150),
  ('MANO_A_MANO',       'G', 'Mano a Mano',                   'Empata 10 o más partidos',                              FALSE,  160),
  ('EL_CORNUDO',        'G', 'El Cornudo',                    'Gana 10 partidos seguidos',                             FALSE,  170),
  ('DEJALO_AMIGO',      'G', 'Dejalo amigo...',               'Pierde 10 partidos seguidos',                           FALSE,  180),
  ('COLECCIONISTA',     'G', 'Coleccionista',                 'Obtén 100 puntos o más en total',                       FALSE,  190),
  ('PERRO_VIEJO',       'G', 'Perro Viejo',                   'Juega 50 o más partidos en total',                      FALSE,  200),
  ('BUSCATE_UN_LABURO', 'G', 'Buscate un Laburo',             'Asiste a 20 partidos seguidos',                         FALSE,  210),
  ('SE_BUSCA',          'G', '¡Se busca!',                    'Auséntate 10 partidos seguidos',                        FALSE,  220),
  ('PICHICHI',          'G', 'Pichichi',                      'Alcanza una diferencia de gol de +50',                  FALSE,  230),
  ('PICHI',             'G', 'Pichi',                         'Alcanza una diferencia de gol de -50',                  FALSE,  240),
  ('PECHOFRIO',         'G', 'Pechofrío',                     'Pierde un torneo liderando las 3 fechas previas',       FALSE,  250),
  ('PURO_HUEVO',        'G', 'Puro Huevo',                    'Sal campeón sin haber liderado las 3 fechas previas',   FALSE,  260),
  ('EX_EQUIPO',         'S', 'Ex-Equipo',                     'Pierde un superclásico por 7 o más goles',              FALSE,  300),
  ('HERMOSA_MANIANA',   'S', '¿Hermosa mañana verdad?',       'Gana un superclásico por 7 o más goles',                FALSE,  310),
  ('LEYENDA',           'S', 'Leyenda',                       'Juega 8 o más superclásicos',                           FALSE,  320),
  ('CAMPEON_DEL_MUNDO', 'M', 'Campeón del Mundo',             'Gana un mundialito',                                    FALSE,  400),
  ('JUEGUEN_ENSERIO',   'M', 'Jueguen enserio che',           'Gana un mundialito invicto',                            FALSE,  410),
  ('INVENTEN_DEPORTE',  'M', 'Inventen otro Deporte',         'Gana todos los partidos de un mundialito',              FALSE,  420),
  ('MEXICANO',          'M', 'Mexicano',                      'Termina 5 mundialitos sin llegar nunca al 5to partido', TRUE,   430),
  ('ETERNO_CANDIDATO',  'M', 'Eterno Candidato',              'Llega a semis en 4 mundialitos sin ganar ninguno',      TRUE,   440),
  ('REPECHAJE',         'M', '¿Entraste por Repechaje?',      'Queda eliminado en fase de grupos con cero puntos',     FALSE,  450),
  ('EZ',                'M', 'EZ',                            'Gana una final por 8 o más goles',                      FALSE,  460),
  ('DIA_PARA_OLVIDO',   'M', 'Día para el olvido',            'Pierde una final por 8 o más goles',                    FALSE,  470);
