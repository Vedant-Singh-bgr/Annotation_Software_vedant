#!/bin/sh
set -e

# Apply any pending Prisma migrations against the production DATABASE_URL, then
# start the standalone Next server. `migrate deploy` is safe to run on every
# boot: it only applies migrations that haven't run yet, and is a no-op otherwise.
echo "[entrypoint] applying database migrations…"
# Invoke the Prisma CLI directly via node. In the slim Next-standalone runtime
# image the `.bin/prisma` shim isn't present, so `npx prisma` / bare `prisma`
# resolve to nothing ("prisma: not found"). The package's bundled entrypoint is
# always at this path once node_modules/prisma is copied in.
node node_modules/prisma/build/index.js migrate deploy

echo "[entrypoint] starting web server on :${PORT:-3000}…"
exec node server.js
