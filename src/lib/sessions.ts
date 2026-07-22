import { prisma } from "@/lib/db";
import { parseManifest } from "@/lib/manifest";

// Import one recording session (from its parsed manifest object) into a Clip +
// ordered ClipSegments. Idempotent per (batch, sessionId): re-importing updates
// the clip and rewrites its segments. Shared by the single-import and bulk-import
// routes. Throws Error on an invalid/empty manifest — callers map to a 400.
export async function importSession(opts: {
  batchId: string;
  defaultFps: number;
  manifest: unknown;
  title?: string;
}): Promise<{ clipId: string; title: string; sessionId: string; segments: number; updated: boolean }> {
  const parsed = parseManifest(opts.manifest, { onlyMcap: true });
  if (parsed.segments.length === 0) throw new Error("Manifest has no MCAP segments.");

  const title =
    (opts.title ?? "").trim() ||
    `${parsed.dataType ?? "session"}_${parsed.sessionId.slice(0, 8)}`;

  const existing = await prisma.clip.findFirst({
    where: { batchId: opts.batchId, sessionId: parsed.sessionId },
    select: { id: true },
  });

  const clip = await prisma.$transaction(async (tx) => {
    const data = {
      batchId: opts.batchId,
      title,
      sizeBytes: parsed.totalBytes || null,
      fps: opts.defaultFps,
      sessionId: parsed.sessionId,
      sessionHash: parsed.sessionHash,
      tenantId: parsed.tenantId,
      worksiteId: parsed.worksiteId,
      workerId: parsed.workerId,
      dataType: parsed.dataType,
      proxyStatus: "pending",
    };
    const c = existing
      ? await tx.clip.update({ where: { id: existing.id }, data })
      : await tx.clip.create({ data });

    await tx.clipSegment.deleteMany({ where: { clipId: c.id } });
    await tx.clipSegment.createMany({
      data: parsed.segments.map((s, i) => ({
        clipId: c.id,
        orderIndex: i,
        logicalPath: s.logicalPath,
        sha256: s.sha256,
        r2BlobKey: s.r2BlobKey,
        sizeBytes: s.sizeBytes,
        contentType: s.contentType,
      })),
    });
    return c;
  });

  return {
    clipId: clip.id,
    title: clip.title,
    sessionId: parsed.sessionId,
    segments: parsed.segments.length,
    updated: Boolean(existing),
  };
}
