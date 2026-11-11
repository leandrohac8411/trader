# ---------- bases ----------
FROM node:20-alpine AS base
WORKDIR /app

# ---------- dependências do server ----------
FROM base AS server_deps
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --omit=dev

# ---------- dependências do client ----------
FROM base AS client_deps
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci

# ---------- build do client ----------
FROM client_deps AS client_build
WORKDIR /app/client
COPY client/ ./
RUN npm run build

# ---------- imagem final (runtime) ----------
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0

# Copia o código do server + node_modules
COPY --from=server_deps /app/server/node_modules /app/server/node_modules
COPY server /app/server

# Copia o build do client para dentro do server
# (ajuste este caminho se seu server servir estático de outra pasta)
COPY --from=client_build /app/client/dist /app/server/client/dist

EXPOSE 4000
CMD ["node", "server/src/index.js"]