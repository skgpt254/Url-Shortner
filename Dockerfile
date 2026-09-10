# syntax=docker/dockerfile:1

# ── Stage 1: build ───────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

# Install deps first so this layer caches across code-only changes.
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ── Stage 2: production dependencies only ───────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund

# ── Stage 3: runtime ─────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Run as a non-root user — never run a production Node process as root;
# a container-escape or dependency RCE has far less blast radius as an
# unprivileged user.
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001
USER nodejs

COPY --chown=nodejs:nodejs --from=deps /app/node_modules ./node_modules
COPY --chown=nodejs:nodejs --from=builder /app/dist ./dist
COPY --chown=nodejs:nodejs package.json ./
# scripts/ + tsconfig + the raw .sql migration files ride along in the
# runtime image (tsx is now a regular dependency, not a devDependency —
# see package.json) so `npm run migrate` / `npm run seed` work directly
# against a running container, and so scripts/migrate.ts can run as part
# of container startup (see docker-entrypoint.sh) with zero extra setup —
# this is what makes a one-click Render deploy actually migrate itself.
COPY --chown=nodejs:nodejs scripts ./scripts
COPY --chown=nodejs:nodejs src/db/migrations ./src/db/migrations
COPY --chown=nodejs:nodejs tsconfig.json ./
COPY --chown=nodejs:nodejs docker-entrypoint.sh ./

EXPOSE 3000

# Container-level health check backs up (doesn't replace) k8s liveness
# probes — useful for plain `docker run` deployments and local dev.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["sh", "docker-entrypoint.sh"]
CMD ["node", "dist/server.js"]
