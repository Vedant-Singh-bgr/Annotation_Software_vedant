// Seed the first admin into the docker-compose Postgres (exposed on localhost:5432).
// Runs the normal prisma seed with DATABASE_URL pointed at the compose DB, so you
// don't have to remember the connection string. Used by `npm run stack:seed`.
import { spawnSync } from "node:child_process";

const DATABASE_URL =
  "postgresql://annotator:annotator@localhost:5432/annotation?schema=public";

const res = spawnSync("npx", ["tsx", "prisma/seed.ts"], {
  stdio: "inherit",
  shell: true, // resolve npx/npx.cmd on Windows
  env: { ...process.env, DATABASE_URL },
});
process.exit(res.status ?? 1);
