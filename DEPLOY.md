# Deploying the annotation platform

The app is two long-lived services + a database + object storage:

| Component | What it is | Host |
|-----------|-----------|------|
| **web** | the Next.js app (`Dockerfile`) | container service |
| **worker** | the Python transcode worker (`Dockerfile.worker`) | container service |
| **Postgres** | the database | managed add-on (Neon / Railway / Render) |
| **R2** | video + export storage | Cloudflare (already set up) |

The worker is **DB-agnostic**: it claims jobs from `POST /api/worker/claim` and
reports results to `POST /api/admin/clips/<id>/proxy`, both secured by
`TRANSCODE_SECRET`. It only needs `APP_URL`, `TRANSCODE_SECRET`, and the `R2_*`
vars — never the database URL.

---

## 1. Provision Postgres

Create a managed Postgres (Neon free tier is enough) and copy its connection
string. It must include SSL, e.g.:

```
postgresql://USER:PASSWORD@HOST/DB?sslmode=require
```

Neon works for local dev too, so you no longer need a local database file.

## 2. Generate secrets

```bash
openssl rand -base64 32   # AUTH_SECRET
openssl rand -base64 32   # TRANSCODE_SECRET
```

## 3. Deploy on Railway (recommended)

Railway runs both containers from this one repo and provisions Postgres.

1. **New Project → Deploy from GitHub repo.**
2. Add a **Postgres** plugin (or paste your Neon `DATABASE_URL`).
3. **web service** — build from `Dockerfile`. Env vars:

   | Var | Value |
   |-----|-------|
   | `DATABASE_URL` | the Postgres URL |
   | `AUTH_SECRET` | generated above |
   | `TRANSCODE_SECRET` | generated above |
   | `R2_ACCOUNT_ID` `R2_ACCESS_KEY_ID` `R2_SECRET_ACCESS_KEY` `R2_BUCKET` | your R2 creds |
   | `R2_URL_TTL` | `3600` |
   | `NODE_ENV` | `production` |

   The container runs `prisma migrate deploy` on boot (creates all tables from
   `prisma/migrations/`), then starts the server. Note the public URL Railway
   assigns (e.g. `https://web-production-xxxx.up.railway.app`).

4. **worker service** — same repo, build from `Dockerfile.worker`. Env vars:

   | Var | Value |
   |-----|-------|
   | `APP_URL` | the web service's public URL (from step 3) |
   | `TRANSCODE_SECRET` | **same** value as the web service |
   | `R2_ACCOUNT_ID` `R2_ACCESS_KEY_ID` `R2_SECRET_ACCESS_KEY` `R2_BUCKET` | your R2 creds |

   The worker needs no `DATABASE_URL`.

Render and Fly.io follow the same shape: one web service from `Dockerfile`, one
background/worker service from `Dockerfile.worker`, a Postgres add-on.

## 4. Seed the first admin

`prisma/seed.ts` creates a platform admin. **Change the default credentials
first** (`admin@platform.dev` / `password123` in the file) — then run it once
against the production DB, e.g. from a one-off shell on the web service:

```bash
npm run db:seed
```

Log in, then create real org admins and annotators through the app (invite-only
— there is no public sign-up).

---

## Local development (also Postgres now)

The schema provider is `postgresql`, so local dev needs a Postgres URL too. Two
options:

- **Neon dev branch** — free, no local disk (best given the constrained C: drive).
- **Local container** — `docker compose up -d db` (see `docker-compose.yml`).

Then:

```bash
cp .env.example .env      # fill in DATABASE_URL, AUTH_SECRET, R2_*, TRANSCODE_SECRET, APP_URL
npx prisma migrate deploy # or: npx prisma migrate dev   (creates + applies)
npm run db:seed
npm run dev               # web app on :3000
python scripts/transcode_worker.py   # worker (separate terminal)
```

## Schema changes after go-live

When you edit `prisma/schema.prisma`, create a migration and commit it:

```bash
npx prisma migrate dev --name describe_change
```

The next deploy applies it automatically via `migrate deploy` on container boot.
Never use `prisma db push` against production — it bypasses migration history.
