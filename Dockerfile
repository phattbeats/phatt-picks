FROM node:24-alpine AS base

# Install openssl for Prisma
RUN apk add --no-cache openssl

WORKDIR /app

# Dependencies
FROM base AS deps
# Toolchain so native modules (e.g. better-sqlite3) compile if no musl prebuilt exists
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json* ./
RUN npm ci --legacy-peer-deps --cache /tmp/npm-cache

# Builder
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma client (downloads musl query + schema engines for this platform)
RUN npx prisma generate

# Build Next.js. A dummy DATABASE_URL keeps any build-time Prisma access from
# choking; no DB connection is opened during the build.
ENV NEXT_TELEMETRY_DISABLED=1
ENV DATABASE_URL="file:/tmp/build.db"
RUN npm run build

# Production runner
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# su-exec lets the entrypoint drop from root → nextjs after fixing /data perms.
RUN apk add --no-cache su-exec

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Data directory for SQLite (mounted from host appdata)
RUN mkdir -p /data && chown nextjs:nodejs /data

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Prisma schema for the startup schema push
COPY --from=builder /app/prisma ./prisma
# Full dependency tree so the Prisma CLI + engines exist at runtime — Next's
# standalone trace omits the CLI, and the CMD below calls `prisma db push` at
# boot to sync the schema (this repo has no migration history). Known choice:
# accepts a fatter runner image in exchange for one-shot schema sync on start.
# Overlays the minimal node_modules that the standalone copy placed above.
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules

COPY scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# No USER directive — entrypoint starts as root so it can chown the bind-mounted
# /data, then exec's as nextjs via su-exec before launching the app.

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Sync the schema into the (possibly fresh) SQLite file, then start. This repo
# manages schema via `prisma db push` rather than migration files, so push —
# not `migrate deploy` — is what creates the tables.
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["sh", "-c", "node_modules/.bin/prisma db push --skip-generate && node server.js"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1
