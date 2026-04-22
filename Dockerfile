# ── Stage 1: Builder ─────────────────────────────────────────────────────────
# Installs all deps (including devDeps) and compiles TypeScript → dist/
FROM node:22-alpine AS builder

WORKDIR /app

# Copy manifests first so this layer is cached unless deps change
COPY package*.json ./
RUN npm ci

# Copy source and compile
COPY . .
RUN npm run build


# ── Stage 2: Production ───────────────────────────────────────────────────────
# Lean image: only production node_modules + compiled dist/
FROM node:22-alpine AS production

WORKDIR /app

# Install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Compiled app from builder stage
COPY --from=builder /app/dist ./dist

# Entrypoint script (runs migrations then starts the app)
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

ENV NODE_ENV=production

# Railway injects $PORT; main.ts reads SERVER_PORT ?? PORT ?? 3000
EXPOSE 7007

ENTRYPOINT ["./docker-entrypoint.sh"]
