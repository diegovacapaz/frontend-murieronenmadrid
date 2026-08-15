# Murieron en Madrid — API

Backend del sistema de torneos: jugadores, partidos, tablas de posiciones y
estadísticas. Reemplaza al sistema hecho con Google Apps Script (`docs/Codigo.gs`
+ `docs/index.html`) conservando su historia completa y sus reglas de cálculo.

NestJS · MySQL 8 con `mysql2` (sin ORM) · stored procedures · websockets.

---

## Cómo levantarlo

### Desarrollo

```bash
docker compose -f ../infra/docker-compose.dev.yml up -d   # solo MySQL
cp .env.example .env                                       # y completar
npm install
npm run start:dev
```

La base queda con el esquema cargado (lo hace `infra/init/01-bootstrap.sh` en el
primer arranque). Para poblarla con la historia real:

```bash
npm run db:seed -- --force
node scripts/verify-migration.mjs   # confirma que las tablas dan igual que antes
```

- API: <http://localhost:3000/api>
- Swagger: <http://localhost:3000/docs>

### Producción

```bash
cp infra/.env.example infra/.env    # y completar
docker compose -f infra/docker-compose.yml up -d --build
```

---

## Cómo está organizado

```
src/
├── main.ts                  bootstrap: prefijo /api, CORS, helmet, Swagger, pipes
├── app.module.ts            ensamblado + guard global de escritura
├── globals/                 lectura tipada de la .env (GlobalsService)
├── database/                pool de mysql2, invocación de SPs, mapeo de errores
├── auth/                    clave única de admin + guard
├── realtime/                gateway de websockets y servicio de notificación
├── common/                  envelope de respuesta, filtro de errores, enums, pipes
└── modules/                 players · tournaments · matches · penalties
                             teams · scoreboard · stats · mundialito
```

Cada módulo sigue la misma cadena, sin excepciones:

```
DTO (valida el formato)
  → Controller (delega, no decide)
    → Service (reglas de negocio, traduce DTO ↔ entidad, notifica)
      → Repository (llama al SP, devuelve entidades vía Factory)
        → MySQL (stored procedures)
```

El repository se inyecta **por interfaz**, no por clase: el service depende de
`IPlayersRepository` y el módulo resuelve el token `PLAYERS_REPOSITORY`.

---

## Las tres decisiones que explican todo lo demás

### 1. El cálculo vive en la base

Las tablas de posiciones, las copas de cada jugador y todas las estadísticas se
calculan en vistas y stored procedures. El backend no suma un punto ni ordena
una fila.

No es dogma: el desempate oficial —**puntos netos → diferencia de gol →
winrate**— aparece en la tabla de un torneo, en la histórica, en el perfil de
cada jugador y en la elección del campeón. Escrito una vez en
`vTournamentStandings`, los cinco lugares lo heredan. Escrito en cada consumidor,
tarde o temprano dos dicen cosas distintas.

Consecuencia práctica: el frontend recibe las filas **ya ordenadas y numeradas**
y solo las pinta.

### 2. Los errores viajan como código, no como texto

Un SP falla así:

```sql
SIGNAL SQLSTATE '45001'                       -- categoría → HTTP status
  SET MYSQL_ERRNO  = 46100,                   -- código    → AppErrorCode
      MESSAGE_TEXT = 'El jugador no existe';  -- texto     → solo al log
```

El backend traduce el número a un `errorCode` estable (`PLAYER_NOT_FOUND`) que
viaja al cliente. El frontend lo usa como clave de i18n y decide en qué idioma lo
dice; el `MESSAGE_TEXT` nunca sale del servidor.

Un `MYSQL_ERRNO` que no esté en el catálogo (`sp-error-codes.constants.ts`)
produce un 500 con log —una falla ruidosa— en vez de una clave de traducción rota
que nadie nota.

| SQLSTATE | Significado      | HTTP |
| -------- | ---------------- | ---- |
| 45000    | Validación       | 400  |
| 45001    | No encontrado    | 404  |
| 45002    | Conflicto        | 409  |
| 45003    | Estado inválido  | 400  |
| 45004    | Prohibido        | 403  |
| 45005    | No autenticado   | 401  |

### 3. Leer es libre, escribir exige la clave

No hay usuarios. Hay **una** clave de administración en la `.env`.

`POST /api/auth/login` la valida (comparación en tiempo constante) y devuelve un
JWT. El `AdminGuard` deja pasar todo `GET` y exige `Authorization: Bearer` en
todo `POST`, `PATCH` y `DELETE`.

La decisión es **por método HTTP y no por decorador en cada endpoint**: así un
endpoint de escritura nuevo nace protegido, y abrirlo requiere pedirlo
explícitamente con `@Public()`. Al revés, un olvido deja un agujero.

---

## Reglas de negocio, y dónde vive cada una

Todas se hacen cumplir en los SPs, que son los únicos que pueden mirar varias
tablas dentro de la misma transacción que escribe.

**Jugadores**
- Nacen activos. Un inactivo no puede ser convocado a partidos nuevos, pero su
  historial sigue contando en todas las tablas.
- Solo se borra si está inactivo, no jugó ningún partido y no tiene
  penalizaciones.

**Torneos**
- Cada torneo define su propia puntuación (la Apertura 2025 pagaba 1 por perder;
  la Clausura 2025, 0.25). Toda tabla se calcula con la puntuación de *su* torneo.
- Solo un torneo **en juego** admite partidos y penalizaciones. Finalizarlo
  consagra al campeón; para corregir algo hay que **reabrirlo**, que es un acto
  explícito.
- No se borra si tiene partidos o penalizaciones.

**Partidos**
- Un derby se juega solo entre Sagrado y Resto del Mundo; uno común, solo entre
  Dark y Light. Lo decide la marca `isDerbyTeam` de la tabla `Teams`, no una lista
  en el código.
- Empate ⟺ diferencia 0. El margen se guarda **sin signo**; de qué lado cae lo
  dice `winnerTeam`.
- Nadie repetido, nadie inactivo. Al editar, los que ya estaban se aceptan aunque
  hoy estén inactivos: dar de baja a alguien no debe congelar los partidos que
  jugó.

**Penalizaciones**
- Una sola por (jugador, torneo), con el acumulado.
- Se restan de los puntos pero **no** afectan el winrate: castigan la tabla, no
  el rendimiento deportivo.

---

## Tiempo real

Cada escritura emite por websocket:

- `player:created` · `player:updated` · `player:deleted`
- `tournament:*` · `match:*` · `penalty:*` — payload: la entidad, en el mismo
  shape que devuelve el endpoint REST
- `scoreboard:invalidated` — payload `{ tournamentId }` (o `null` si afecta a
  todos)

Las tablas no viajan por socket a propósito: recalcularlas es trabajo de la base
y mandarlas enteras quedaría desincronizado del criterio de orden. El frontend
recibe el aviso y refetchea solo la tabla que está mirando.

El canal es de **una sola dirección**: el servidor emite, nadie manda comandos.
Toda escritura entra por HTTP, donde el guard puede exigir el token.

---

## La base

```
Players ──< MatchPlayers >── Matches ──> Tournaments
   │                            │             │
   └──────< PlayerPenalties >───┴─────────────┘
                    Teams (catálogo fijo: D, L, S, R)
```

`database/schema.sql` (tablas) · `views.sql` (el motor de cálculo) ·
`procedures/` (un archivo por módulo).

Las vistas encadenadas son el corazón del sistema:

```
vMatchPlayerResults       el partido visto desde cada jugador (W/D/L + dif firmada)
vPlayerTournamentTotals   PJ/G/E/P por jugador y torneo
vTournamentScoreboard     + puntos, techo, winrate y penalización
vTournamentStandings      + posición (desempate oficial)
vTournamentChampions      el 1º de cada torneo finalizado
vGeneralScoreboard/Standings   lo mismo, sumando todos los torneos
```

Y la cadena del mundialito, que corre aparte porque no es una agregación sino un
plegado con reinicio sobre los partidos de cada jugador:

```
vMundialitoMatches        partidos elegibles, numerados por jugador
vMundialitoRuns           + mundialito, puesto, fase y desenlace (CTE recursivo)
vMundialitoEndedRuns      las corridas ya cerradas: base de toda estadística
vMundialitoPlayerStats    rendimiento por jugador (clasificación, mata-mata, sequía)
vMundialitoKnockouts      quién estaba enfrente en cada eliminación
vMundialitoRunBalls       cada corrida con sus partidos armados en JSON
vMundialitoCurrent        la vigente de cada uno · vMundialitoBestRun la mejor
vMundialitoTitles         cuántos ganó cada uno y cuándo ganó el primero
```

### Reaplicar cambios de esquema

`init/01-bootstrap.sh` solo corre la primera vez (cuando el volumen está vacío).
Para publicar un cambio en un SP sin perder datos:

```bash
node scripts/apply-sql.mjs                    # vistas + todos los procedures
node scripts/apply-sql.mjs procedures/players.sql
```

Corre como `root`: MySQL 8 no deja que un usuario común reemplace rutinas cuyo
`DEFINER` es una cuenta con `SYSTEM_USER`, y el bootstrap las crea como root.

---

## Scripts

| Comando                              | Qué hace                                            |
| ------------------------------------ | --------------------------------------------------- |
| `npm run start:dev`                  | API con hot reload                                   |
| `npm run build`                      | Compila a `dist/`                                    |
| `npm run lint`                       | ESLint con type-checking                             |
| `npm run db:seed -- --force`         | Migra la historia desde `docs/Codigo.gs`             |
| `node scripts/verify-migration.mjs`  | Compara las tablas nuevas contra el sistema original |
| `node scripts/verify-mundialito.mjs` | Recalcula el mundialito en JS y lo contrasta con la base |
| `node scripts/apply-sql.mjs`         | Reaplica vistas y procedures                         |

---

## La migración

`scripts/seed.mjs` lee la constante `SEED` de `docs/Codigo.gs` y carga todo **a
través de los stored procedures**, no con INSERT directo: si el seed pasa, quedan
probadas de punta a punta las mismas validaciones que va a usar el frontend.

`scripts/verify-migration.mjs` reimplementa literalmente el algoritmo de
`computeTournament`/`computeGeneral` del `index.html` viejo y compara, valor por
valor, contra lo que devuelve la base. Hoy **todos los valores coinciden**.

Las únicas diferencias son de orden entre jugadores empatados en los tres
criterios de desempate: el sistema viejo los dejaba como venían del objeto
acumulador y el nuevo desempata por `playerId`, que al menos es estable entre
consultas. El script las informa aparte, sin fallar.

### El torneo 2024

Del torneo 2024 solo sobrevivió la tabla final del Excel: por jugador, cuántos
jugó, ganó y perdió. Los partidos no se anotaron nunca.

Como el modelo nuevo calcula todo desde los partidos, el seed **genera partidos
sintéticos** cuya tabla resultante es exactamente la del Excel. Son 5 partidos
—el mínimo posible, porque el que más jugó tiene 5 apariciones y nadie juega dos
veces el mismo partido— con diferencia de gol 0, que es lo que corresponde a un
marcador que nunca se registró.

El torneo queda marcado con `wasTracked = false`. El frontend no debe listar sus
partidos; están para que la tabla cierre.
