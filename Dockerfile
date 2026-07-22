# ── Web app: Next.js (standalone) ────────────────────────────────────────────
# Multi-stage: install deps, build, then a slim runtime image that runs
# `node server.js`. Prisma migrations are applied at container start (entrypoint)
# so a fresh Postgres is provisioned on first deploy.

FROM node:20-slim AS deps
WORKDIR /app
# openssl is required by Prisma's query engine at runtime and generate time.
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npm run build

FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

# Standalone server + static assets + public dir.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/prisma ./prisma
# Full node_modules (overlays the standalone's minimal traced set). Needed because
# `prisma migrate deploy` on boot pulls in the CLI's whole transitive dependency
# tree (@prisma/config -> effect, etc.) that a cherry-picked copy can't cover.
COPY --from=build /app/node_modules ./node_modules

COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x docker-entrypoint.sh

EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
ENTRYPOINT ["./docker-entrypoint.sh"]
