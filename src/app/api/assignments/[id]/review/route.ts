import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { handle, HttpError } from "@/lib/api";
import { getAuthorizedAssignment } from "@/lib/access";
import { buildAssignmentExport } from "@/lib/export";
import { resolveClipUrl } from "@/lib/r2";

type Ctx = { params: Promise<{ id: string }> };

// One-shot "review bundle": a fresh presigned playback URL for the clip's proxy
// (streamed from R2) + the export JSON (generated from the DB). Both are keyed by
// the same assignment id, so the overlay always pairs the right JSON with the
// right clip — nothing is stored on disk.
export async function GET(req: NextRequest, { params }: Ctx) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await params;
    const assignment = await getAuthorizedAssignment(user, id);

    // ?source=original plays the untouched upload instead of the scrub proxy.
    // resolveClipUrl always prefers the proxy once one exists, which is right
    // for scrubbing but wrong when you want to check the labels against the
    // full-quality master. Frame indices are identical in both, so the overlay
    // lines up either way.
    const want = new URL(req.url).searchParams.get("source");
    const clip = assignment.clip;
    let resolved =
      want === "original" && clip.r2Key
        ? await resolveClipUrl({ r2Key: clip.r2Key, sourceUrl: clip.sourceUrl })
        : null;
    let servedOriginal = resolved !== null;
    if (!resolved) {
      resolved = await resolveClipUrl(clip);
      servedOriginal = false;
    }
    if (!resolved) {
      throw new HttpError(
        409,
        "This clip has no playable proxy yet (transcode pending) and no fallback URL.",
      );
    }

    const exportPayload = await buildAssignmentExport(assignment);
    return {
      playbackUrl: resolved.url,
      source: resolved.source,
      // Which video the labels are being drawn over, so the viewer can say so.
      playing: servedOriginal ? "original" : clip.proxyR2Key ? "proxy" : "original",
      export: exportPayload,
    };
  });
}
