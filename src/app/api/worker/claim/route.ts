import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { handle, forbidden } from "@/lib/api";

// Job-claim endpoint for the standalone transcode worker.
//
// The worker used to read SQLite directly; on managed Postgres that no longer
// works and coupling a separate process to the DB schema is fragile. Instead the
// worker polls THIS endpoint (shared-secret auth, same TRANSCODE_SECRET it uses
// to report results). We atomically claim the next queued clip here and hand back
// exactly the manifest fields the worker needs — so the worker stays completely
// DB-agnostic and needs no database credentials of its own.
function authorize(req: NextRequest): void {
  const secret = process.env.TRANSCODE_SECRET;
  const header = req.headers.get("x-transcode-secret");
  if (!secret) forbidden("TRANSCODE_SECRET is not configured.");
  if (header !== secret) forbidden("Invalid worker secret.");
}

// Claim a queued overlay render (burn an approved assignment's labels onto its
// video). Returns null when there is nothing to do, so the caller can fall
// through. Same atomic claim pattern as the transcode path.
async function claimOverlay() {
  const candidate = await prisma.assignment.findFirst({
    where: { overlayStatus: "queued", status: "APPROVED" },
    orderBy: { updatedAt: "asc" },
    select: { id: true },
  });
  if (!candidate) return null;

  const claimed = await prisma.assignment.updateMany({
    where: { id: candidate.id, overlayStatus: "queued" },
    data: { overlayStatus: "rendering", overlayError: null },
  });
  if (claimed.count === 0) return null; // lost the race

  const a = await prisma.assignment.findUnique({
    where: { id: candidate.id },
    include: { clip: true },
  });
  if (!a) return null;

  // Burn onto the ORIGINAL upload by default so the deliverable is full quality,
  // not the downscaled scrub proxy. Frame indices are identical in both, so the
  // labels line up either way; this is purely about output fidelity. Fall back
  // to whichever one actually exists.
  const original = a.clip.r2Key ?? null;
  const proxy = a.clip.proxyR2Key ?? null;
  const preferred = a.overlaySource === "proxy" ? proxy : original;
  const videoKey = preferred ?? proxy ?? original;
  if (!videoKey || !a.exportR2Key) {
    await prisma.assignment.update({
      where: { id: a.id },
      data: {
        overlayStatus: "failed",
        overlayError: !videoKey
          ? "No source video in R2 to burn onto."
          : "No published export JSON — publish the assignment first.",
      },
    });
    return null;
  }

  // Land the overlay beside the export it was rendered from.
  const dir = a.exportR2Key.replace(/\/annotations\/[^/]*$/, "");
  return {
    kind: "overlay" as const,
    assignmentId: a.id,
    videoKey,
    exportKey: a.exportR2Key,
    overlayKey: `${dir}/overlays/${a.id}.mp4`,
    source: videoKey === original ? "original" : "proxy",
  };
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    authorize(req);

    // Atomic claim: find the oldest queued clip, then flip it to transcoding
    // only if it is still queued (updateMany count guards against a race with
    // another worker instance).
    const candidate = await prisma.clip.findFirst({
      where: { proxyStatus: "queued" },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    // Transcodes come first: an overlay burns onto a video the transcode may
    // still be producing, so draining proxies keeps the pipeline in order.
    if (!candidate) {
      const overlay = await claimOverlay();
      return { job: overlay };
    }

    const claimed = await prisma.clip.updateMany({
      where: { id: candidate.id, proxyStatus: "queued" },
      data: { proxyStatus: "transcoding", proxyError: null },
    });
    if (claimed.count === 0) return { job: null }; // lost the race; try next poll

    const clip = await prisma.clip.findUnique({
      where: { id: candidate.id },
      include: { segments: { orderBy: { orderIndex: "asc" } } },
    });
    if (!clip) return { job: null };

    return {
      job: {
        // Job kind, so the worker dispatches explicitly rather than sniffing
        // which fields happen to be present.
        kind: "transcode" as const,
        clipId: clip.id,
        // "session" = concatenate MCAP segments; "flat" = one video object in the
        // bucket (an imported MP4) that just needs the scrub-friendly re-encode.
        // The worker branches on this rather than guessing from empty segments[].
        mode: clip.sessionId ? "session" : "flat",
        sourceKey: clip.sessionId ? null : clip.r2Key,
        proxyKey: clip.sessionId
          ? clip.tenantId
            ? `tenants/${clip.tenantId}/proxies/${clip.sessionId}/ego.mp4`
            : `proxies/${clip.sessionId}/ego.mp4`
          : `proxies/clips/${clip.id}/proxy.mp4`,
        sessionId: clip.sessionId,
        sessionHash: clip.sessionHash,
        tenantId: clip.tenantId,
        workerId: clip.workerId,
        dataType: clip.dataType,
        segments: clip.segments.map((s) => ({
          logical_path: s.logicalPath,
          checksum_sha256: s.sha256,
          r2_object_key: s.r2BlobKey,
          size_bytes: s.sizeBytes,
          content_type: s.contentType,
        })),
      },
    };
  });
}
