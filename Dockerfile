# ── Stage 1: Builder ─────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Install dependencies first for better layer caching.
COPY package.json package-lock.json ./
RUN npm ci

# Copy everything else (node_modules and dist are excluded via .dockerignore)
COPY . .
RUN npm run build

# Prune to production deps only
RUN npm prune --omit=dev


# ── Stage 2: Production ───────────────────────────────────────────────────────
# Copy pre-built artifacts — no npm install needed in this stage
FROM node:22-alpine AS production

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist         ./dist
COPY --from=builder /app/package.json ./package.json

COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

ENV NODE_ENV=production

# Railway injects $PORT; main.ts reads SERVER_PORT ?? PORT ?? 3000
EXPOSE 7007

ENTRYPOINT ["./docker-entrypoint.sh"]
