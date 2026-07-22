#!/bin/sh
set -e

# Apply any pending Prisma migrations against the production DATABASE_URL, then
# start the standalone Next server. `migrate deploy` is safe to run on every
# boot: it only applies migrations that haven't run yet, and is a no-op otherwise.
echo "[entrypoint] applying database migrations…"
npx prisma migrate deploy

echo "[entrypoint] starting web server on :${PORT:-3000}…"
exec node server.js
