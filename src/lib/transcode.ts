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
  // Two kinds of clip can be transcoded:
  //   * a session — many MCAP segments concatenated into one proxy;
  //   * a flat clip — a single video imported straight from the bucket.
  // A flat MP4 already plays, but it carries the recorder's GOP and resolution,
  // so scrubbing it stalls. Giving it the same proxy treatment is the whole point.
  const isSession = Boolean(clip.sessionId);
  if (isSession && clip.segments.length === 0) throw new Error("Clip has no segments.");
  if (!isSession && !clip.r2Key)
    throw new Error("This clip has no R2 object to transcode (no session segments, no r2Key).");
  if (clip.proxyStatus === "queued" || clip.proxyStatus === "transcoding")
    throw new Error("A transcode is already queued or running for this clip.");
  if (!isR2Configured())
    throw new Error("R2 is not configured, so the worker can't fetch the source video.");
  if (!process.env.TRANSCODE_SECRET)
    throw new Error("Set TRANSCODE_SECRET so the worker can report its result back.");

  // Never write the proxy over the source object: a flat clip's r2Key IS the
  // original upload, and overwriting it would destroy the master.
  const proxyKey = isSession
    ? clip.tenantId
      ? `tenants/${clip.tenantId}/proxies/${clip.sessionId}/ego.mp4`
      : `proxies/${clip.sessionId}/ego.mp4`
    : `proxies/clips/${clip.id}/proxy.mp4`;

  await prisma.clip.update({
    where: { id: opts.clipId },
    data: { proxyStatus: "queued", proxyError: null },
  });

  return { proxyKey };
}
