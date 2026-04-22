# ── Stage 1: Builder ─────────────────────────────────────────────────────────
# Installs all deps (including devDeps) and compiles TypeScript → dist/
FROM node:22-alpine AS builder

WORKDIR /app

# Copy manifests first so this layer is cached unless deps change
COPY package*.json ./
# --ignore-platform: package-lock.json was generated on macOS (darwin/arm64)
# and locks some native binaries for that platform. This flag tells npm to
# skip the platform check and let the correct linux/x64 binary be resolved.
RUN npm ci --ignore-platform

# Copy source and compile
COPY . .
RUN npm run build


# ── Stage 2: Production ───────────────────────────────────────────────────────
# Lean image: only production node_modules + compiled dist/
FROM node:22-alpine AS production

WORKDIR /app

# Install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev --ignore-platform && npm cache clean --force

# Compiled app from builder stage
COPY --from=builder /app/dist ./dist

# Entrypoint script (runs migrations then starts the app)
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

ENV NODE_ENV=production

# Railway injects $PORT; main.ts reads SERVER_PORT ?? PORT ?? 3000
EXPOSE 7007

ENTRYPOINT ["./docker-entrypoint.sh"]
