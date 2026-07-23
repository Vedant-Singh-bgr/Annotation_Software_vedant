import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { handle, badRequest, forbidden } from "@/lib/api";

type Ctx = { params: Promise<{ id: string }> };

// Ingest the result of scripts/transcode_session.py for one session clip.
//
// This is the missing link that closes the MCAP -> playable-proxy loop:
//   import (proxyStatus="pending") -> transcode -> [THIS ROUTE] -> proxyStatus="ready"
//
// It writes Clip.fps/frameCount/durationSec/proxyR2Key(+sourceUrl) and the
// per-segment frame ranges on ClipSegment (which the export's source-mapping and
// the Q panel both depend on). Idempotent: re-posting just rewrites the values.
//
// Callers:
//   * the admin UI (paste the transcode metadata JSON) — auth via session cookie;
//   * transcode_session.py --report-url (auto/CLI) — auth via x-transcode-secret.
//
// Body accepts either the raw transcode metadata (the script's stdout) or a
// wrapper { metadata, sourceUrl?, proxyR2Key?, status?, error? }.

type SegMeta = { logical_path: string; start_frame: number; end_frame: number };

async function authorize(req: NextRequest): Promise<void> {
  const secret = process.env.TRANSCODE_SECRET;
  const header = req.headers.get("x-transcode-secret");
  if (secret && header && header === secret) return; // machine caller
  const user = await getSession();
  if (user?.role === "PLATFORM_ADMIN") return; // human caller
  forbidden("A platform-admin session or a valid x-transcode-secret is required.");
}

export async function POST(req: NextRequest, { params }: Ctx) {
  return handle(async () => {
    await authorize(req);
    const { id } = await params;

    const clip = await prisma.clip.findUnique({
      where: { id },
      include: { segments: { orderBy: { orderIndex: "asc" } } },
    });
    if (!clip) badRequest("Clip not found.");

    const body = (await req.json().catch(() => null)) as Record<string, any> | null;
    if (!body) badRequest("Body must be JSON.");

    // Explicit failure report (transcode crashed).
    if (body.status === "failed") {
      const updated = await prisma.clip.update({
        where: { id },
        data: { proxyStatus: "failed", proxyError: String(body.error ?? "transcode failed") },
      });
      return { clip: { id: updated.id, proxyStatus: updated.proxyStatus }, ok: true };
    }

    // Metadata may be nested under `metadata` (UI wrapper) or at the top level
    // (raw script stdout).
    const meta: Record<string, any> = body.metadata ?? body;

    const segMeta: SegMeta[] = Array.isArray(meta.segments) ? meta.segments : [];
    // A flat clip (a single video imported from the bucket) has no MCAP segments,
    // so it legitimately reports none. Only a session must account for its
    // segments — for those, an empty list means the transcode told us nothing
    // about frame ranges and the export's source mapping would be wrong.
    if (segMeta.length === 0 && clip!.segments.length > 0)
      badRequest("Transcode metadata has no segments[] with frame ranges.");

    const fps = Number(meta.fps);
    if (!Number.isFinite(fps) || fps <= 0) badRequest("Transcode metadata is missing a valid fps.");

    // Match reported segments to the clip's segments by logical_path.
    const byPath = new Map(clip!.segments.map((s) => [s.logicalPath, s]));
    const missing = segMeta.filter((s) => !byPath.has(s.logical_path)).map((s) => s.logical_path);
    if (missing.length)
      badRequest(
        `Metadata references segment(s) not on this clip: ${missing.slice(0, 3).join(", ")}` +
          (missing.length > 3 ? ` (+${missing.length - 3} more)` : ""),
      );

    // Prefer the reported total; fall back to the highest segment end frame.
    // Math.max() of an empty list is -Infinity, so guard the flat-clip case
    // (no segments) rather than writing a nonsense frame count.
    const frameCount =
      Number.isFinite(Number(meta.frame_count)) && Number(meta.frame_count) > 0
        ? Math.round(Number(meta.frame_count))
        : segMeta.length > 0
          ? Math.max(...segMeta.map((s) => Number(s.end_frame) || 0))
          : 0;
    if (frameCount <= 0) badRequest("Transcode metadata is missing a valid frame count.");
    const durationSec =
      Number.isFinite(Number(meta.duration_sec)) && Number(meta.duration_sec) > 0
        ? Number(meta.duration_sec)
        : frameCount / fps;

    const proxyR2Key =
      (typeof body.proxyR2Key === "string" && body.proxyR2Key.trim()) ||
      (typeof meta.uploaded_key === "string" && meta.uploaded_key.trim()) ||
      clip!.proxyR2Key ||
      null;
    // Demo playback: an already-playable URL when there is no R2 proxy.
    const sourceUrl =
      (typeof body.sourceUrl === "string" && body.sourceUrl.trim()) || clip!.sourceUrl || null;

    await prisma.$transaction(async (tx) => {
      await tx.clip.update({
        where: { id },
        data: {
          fps,
          frameCount,
          durationSec,
          proxyR2Key,
          sourceUrl,
          proxyStatus: "ready",
          proxyError: null,
        },
      });
      for (const s of segMeta) {
        const seg = byPath.get(s.logical_path)!;
        const start = Math.round(Number(s.start_frame) || 0);
        const end = Math.round(Number(s.end_frame) || 0);
        await tx.clipSegment.update({
          where: { id: seg.id },
          data: {
            startFrame: start,
            endFrame: end,
            startTimeSec: start / fps,
            endTimeSec: end / fps,
          },
        });
      }
    });

    return {
      ok: true,
      clip: { id, proxyStatus: "ready", fps, frameCount, durationSec, proxyR2Key },
      segmentsUpdated: segMeta.length,
    };
  });
}
