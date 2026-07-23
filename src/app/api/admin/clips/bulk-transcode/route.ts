import { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth";
import { handle, badRequest } from "@/lib/api";
import { triggerTranscode } from "@/lib/transcode";

// Queue the proxy transcode for many clips in one call, so a whole batch can be
// kicked off from one selection instead of opening each clip's panel in turn.
//
// Per-clip failures do NOT fail the request: triggerTranscode refuses clips that
// are already queued/running or have nothing to transcode, and one such clip in
// a 50-clip selection shouldn't discard the other 49. Every clip is reported
// individually so the UI can say exactly which ones were skipped and why.
export async function POST(req: NextRequest) {
  return handle(async () => {
    await requireRole("PLATFORM_ADMIN");
    const body = await req.json().catch(() => null);

    const clipIds: string[] = Array.isArray(body?.clipIds)
      ? body.clipIds.map((v: unknown) => String(v)).filter(Boolean)
      : [];
    if (clipIds.length === 0) badRequest("Select at least one clip.");
    // force: re-queue clips stuck in queued/transcoding after a worker restart.
    const force = Boolean(body?.force);

    const results: { clipId: string; ok: boolean; error?: string }[] = [];
    // Sequential on purpose: each call writes the clip's proxyStatus, and the
    // worker claims one job at a time anyway, so there's nothing to gain from
    // hammering the database in parallel.
    for (const clipId of clipIds) {
      try {
        await triggerTranscode({ clipId, force });
        results.push({ clipId, ok: true });
      } catch (e) {
        results.push({ clipId, ok: false, error: (e as Error).message });
      }
    }

    const queued = results.filter((r) => r.ok).length;
    return { queued, skipped: results.length - queued, results };
  });
}
