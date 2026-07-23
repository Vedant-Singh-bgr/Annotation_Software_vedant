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
export async function GET(_req: NextRequest, { params }: Ctx) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await params;
    const assignment = await getAuthorizedAssignment(user, id);

    const resolved = await resolveClipUrl(assignment.clip);
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
      export: exportPayload,
    };
  });
}
