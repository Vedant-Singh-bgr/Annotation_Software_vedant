import { prisma } from "@/lib/db";
import { isR2Configured } from "@/lib/r2";

// Enqueue a session clip for the standalone transcode worker.
//
// We intentionally do NOT spawn ffmpeg from the Next request handler: on Windows
// the dev server's recompiles / worker recycling kill the long-running child
// (0xC000013A). Instead we mark the clip `queued`; `scripts/transcode_worker.py`
// (a separate long-lived process) claims it, runs the MCAP->H.264 transcode,
// uploads the proxy, and POSTs the result back to /api/admin/clips/[id]/proxy.
export async function triggerTranscode(opts: {
  clipId: string;
}): Promise<{ proxyKey: string }> {
  const clip = await prisma.clip.findUnique({
    where: { id: opts.clipId },
    include: { segments: { orderBy: { orderIndex: "asc" } } },
  });
  if (!clip) throw new Error("Clip not found.");
  if (!clip.sessionId) throw new Error("This clip is not a session (no MCAP segments to transcode).");
  if (clip.segments.length === 0) throw new Error("Clip has no segments.");
  if (clip.proxyStatus === "queued" || clip.proxyStatus === "transcoding")
    throw new Error("A transcode is already queued or running for this clip.");
  if (!isR2Configured())
    throw new Error("R2 is not configured, so the worker can't fetch the MCAP blobs.");
  if (!process.env.TRANSCODE_SECRET)
    throw new Error("Set TRANSCODE_SECRET so the worker can report its result back.");

  const proxyKey = clip.tenantId
    ? `tenants/${clip.tenantId}/proxies/${clip.sessionId}/ego.mp4`
    : `proxies/${clip.sessionId}/ego.mp4`;

  await prisma.clip.update({
    where: { id: opts.clipId },
    data: { proxyStatus: "queued", proxyError: null },
  });

  return { proxyKey };
}
