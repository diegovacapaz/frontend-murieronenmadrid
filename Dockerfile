# syntax=docker/dockerfile:1
# =============================================================================
# Imagen de la API — build multi-stage
# =============================================================================
# Etapa 1 compila con todas las dependencias; etapa 2 se queda solo con las de
# produccion y el dist. La imagen final no lleva TypeScript ni el CLI de Nest.
# =============================================================================

FROM node:22-alpine AS builder

WORKDIR /app

# Las dependencias se copian primero para que Docker cachee `npm ci` y no lo
# repita cada vez que cambia una linea de codigo.
COPY package.json package-lock.json* ./
RUN npm ci

COPY tsconfig.json nest-cli.json ./
COPY src ./src

RUN npm run build

# -----------------------------------------------------------------------------

FROM node:22-alpine AS runner

# Esta variable NO la lee la aplicacion: no esta declarada en env.validation.ts
# y ningun archivo de src/ la consulta. Queda porque la leen las dependencias
# (Express desactiva salidas de debug, varias librerias saltean trabajo de
# desarrollo). Es convencion del ecosistema Node, no configuracion nuestra.
ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist

# El esquema viaja en la imagen para poder reaplicarlo con scripts/apply-sql.mjs
# sin necesitar el repo montado.
COPY database ./database
COPY scripts ./scripts

# Nunca root: la imagen de node trae el usuario `node` justamente para esto.
USER node

EXPOSE 3000

CMD ["node", "dist/main.js"]
