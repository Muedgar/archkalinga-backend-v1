# ── Stage 1: Builder ─────────────────────────────────────────────────────────
# Installs all deps (including devDeps) and compiles TypeScript → dist/
FROM node:22-alpine AS builder

WORKDIR /app

# Copy manifests only — package-lock.json was generated on macOS (darwin/arm64)
# so we use `npm install` (not `npm ci`) to let npm resolve the correct
# linux/x64 native binaries fresh rather than being bound by the lockfile.
COPY package*.json ./
RUN npm install

# Copy source and compile
COPY . .
RUN npm run build


# ── Stage 2: Production ───────────────────────────────────────────────────────
# Lean image: only production node_modules + compiled dist/
FROM node:22-alpine AS production

WORKDIR /app

# Production deps only — same reason as builder: fresh install for linux/x64
COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force

# Compiled app from builder stage
COPY --from=builder /app/dist ./dist

# Entrypoint script (runs migrations then starts the app)
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

ENV NODE_ENV=production

# Railway injects $PORT; main.ts reads SERVER_PORT ?? PORT ?? 3000
EXPOSE 7007

ENTRYPOINT ["./docker-entrypoint.sh"]
