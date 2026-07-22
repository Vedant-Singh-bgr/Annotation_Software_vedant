# Annotation Platform — Kosha Labs v4 (video hand-manipulation)

A multi-tenant **video annotation SaaS**. The platform owner holds the data in
Cloudflare **R2**, pulls clips into the system, and assigns them to annotation
companies. Annotators follow the Kosha v4 guideline and produce structured output.

Everything temporal is a **frame index** (integer, first frame = 0), per the
guideline — never seconds. `fps` (default 30) lives on the batch/clip.

## The annotation schema (Kosha v4)

| Level | Span | Captures |
|-------|------|----------|
| **L1 — Task** | 30 s–15 min | Long-horizon tasks found from scratch: `start/end_frame` (±30f), `label` (verb_noun), `difficulty`, `venue_L2`, `venue_L3`, `job`, `confidence`, `quality_flags` |
| **L2 — Sub-task** | 1–5 s | Atomic actions tiling each task (no gaps/overlaps, ±15f): `action_label` (snake_case), dense left/right-hand `description`, `object_left`, `object_right` |
| **Q — Frame quality** | every Nth frame | `real_work`, `repetitive`, `occluded`, `smudge`, `glare`, `blur` per sampled frame (cadence per batch, default 45) |

## Roles

| Role | Who | Can do |
|------|-----|--------|
| `PLATFORM_ADMIN` | You | Create orgs & projects, **import clips from R2**, manage the approved lists, assign projects to orgs |
| `ORG_ADMIN` | Annotation company | Manage annotators, assign clips, review |
| `ANNOTATOR` | Labeler | Annotate assigned clips (L1/L2/Q), submit |

## Hierarchy

```
Organization → Project → Batch → Clip → Assignment → { Task → SubTask,  FrameQuality }
                          │        │
                          │        └─ pulled from R2 (r2Key) or a fallback sourceUrl
                          └─ per-batch config: Q cadence (sampleEveryN), default fps
```

Approved lists (Appendix A: `venue_L2`, `venue_L3`, `job`) live in `TaxonomyItem`
and are edited in-app — annotators select from them, they can't free-type.

## Stack

Next.js 15 (App Router, TS) · Prisma · **SQLite** in dev / Postgres in prod ·
Cloudflare R2 (S3-compatible: `ListObjectsV2` for browsing, presigned GET for
streaming) · JWT httpOnly-cookie auth · Tailwind.

## Quick start

```bash
npm install
npm run setup        # prisma generate + db push + seed
npm run dev          # http://localhost:3000
```

Demo accounts (password `password123`): `admin@platform.dev` (platform),
`lead@labelco.dev` (org admin), `ann@labelco.dev` (annotator, has clips).

## Pulling clips from R2

1. Set `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` in `.env`.
2. **Projects & Clips → open a project → New batch** (set the R2 prefix + Q cadence + fps).
3. **Import from R2**: browse the bucket folder-by-folder, tick the video objects, Import.
   Credentials never reach the browser; the server lists and later presigns.

Without R2 creds the platform runs in **demo mode** — live browsing is disabled and
you add clips manually by key/URL (clips stream from a fallback `sourceUrl`).

## Status

- ✅ **Phase 1: schema + R2 ingest.** Frame-based L1/L2/Q data model,
  project→batch→clip hierarchy, R2 browse-and-import, admin-editable approved
  lists, assignment flow.
- ✅ **Phase 2: the L1/L2/Q annotation workspace.** Frame-accurate video nav
  (±1/±10 frame stepping, `I`/`O` in-out marking), L1 task editor (label,
  difficulty, taxonomy-backed venue/job pickers, quality flags, confidence),
  L2 sub-task editor with **live coverage/gap/overlap validation**, the Q
  frame-quality sampling panel, submit/approve/reject, and structured JSON
  export matching the guideline's Required Output Fields (`L1_tasks`,
  `L2_subtasks`, `Q_frame_quality`).
- ✅ **Phase 3: session/MCAP-native ingest.** A clip = one recording **session**
  (uploaded as many ~4-min **MCAP** segments). `ClipSegment` records each
  segment's provenance (sha256, R2 blob key, frame range). **Session import**
  reads the upload `manifest.json` (paste JSON or R2 key). Since MCAP isn't
  browser-playable, `scripts/transcode_session.py` stream-copies the left-camera
  H.264 across segments into one **MP4 proxy** (no re-encode) and reports true
  fps + per-segment frame ranges; the workspace plays the proxy. Export gains a
  `session` block + per-annotation `source_start/source_end` mapping back to
  `(segment, frame_in_segment, sha256)`.
- ✅ **Phase 3.5: closed transcode loop.** The MCAP→proxy pipeline now writes
  back: `POST /api/admin/clips/[id]/proxy` ingests the transcode metadata (fps,
  frame_count, per-segment frame ranges) and flips `proxyStatus` pending→ready;
  `POST /api/admin/clips/[id]/transcode` rebuilds a manifest from the DB segments
  and runs `transcode_session.py` in the background (needs R2 + Python), which
  reports back via `--report-url` (auth: `TRANSCODE_SECRET`). Admins can also
  paste the transcode result (or a demo playback URL) from the project screen.
- ⏭️ **Next:** wire real R2 creds and validate frame-accuracy on one real
  session (topic/codec/seek assumptions), reviewer approve/reject UI, stereo
  (left+right) handling, QA metrics.

### MCAP → proxy transcode

```bash
# local segments (proven): produces proxy.mp4 + metadata JSON
python scripts/transcode_session.py --out proxy.mp4 \
    --mcap seg_004.mcap --mcap seg_005.mcap
# from a session manifest (downloads blobs from R2; needs R2_* env)
python scripts/transcode_session.py --manifest manifest.json --out proxy.mp4 \
    --upload-key tenants/<t>/proxies/<session>/ego.mp4
```


### Annotation shortcuts

`Space` play/pause · `←/→` step 1 frame (Shift = 10) · `I` / `O` mark task
in/out · `Esc` clear. All field edits save automatically (debounced).

## Project layout

```
prisma/schema.prisma   Kosha v4 data model
src/lib/kosha.ts       guideline constants + frame<->time helpers
src/lib/r2.ts          R2 listing + presigning
src/app/(app)/admin/   projects, batches, R2 import, taxonomies
src/app/(app)/annotate/[assignmentId]/  clip preview (workspace lands in Phase 2)
```
