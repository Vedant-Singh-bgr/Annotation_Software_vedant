import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { handle, badRequest } from "@/lib/api";
import { headR2Object, isR2Configured } from "@/lib/r2";

type IncomingClip = { key: string; title?: string; size?: number };

function titleFromKey(key: string): string {
  const base = key.split("/").pop() || key;
  return base.replace(/\.[^.]+$/, "");
}

// Import selected R2 objects into a batch as clips. Idempotent per (batch, key).
export async function POST(req: NextRequest) {
  return handle(async () => {
    await requireRole("PLATFORM_ADMIN");
    const body = await req.json().catch(() => null);

    const batchId = String(body?.batchId ?? "");
    const items: IncomingClip[] = Array.isArray(body?.clips) ? body.clips : [];
    if (!batchId) badRequest("batchId is required.");
    if (items.length === 0) badRequest("Select at least one clip to import.");

    const batch = await prisma.batch.findUnique({
      where: { id: batchId },
      select: { id: true, defaultFps: true },
    });
    if (!batch) badRequest("Batch not found.");

    // Which keys already exist in this batch?
    const keys = items.map((i) => String(i.key)).filter(Boolean);
    const existing = await prisma.clip.findMany({
      where: { batchId, r2Key: { in: keys } },
      select: { r2Key: true },
    });
    const existingKeys = new Set(existing.map((e) => e.r2Key));

    const fresh = items.filter((i) => i.key && !existingKeys.has(i.key));

    // Read each object's identity from R2 rather than trusting the size the
    // browser sent. Without this a flat MP4 clip is bound to its annotations by
    // key string alone, so replacing the bytes at that key would silently
    // repoint every published label file at different video. headR2Object never
    // throws — a failed HEAD leaves the columns null and the import proceeds.
    const identities = await Promise.all(
      fresh.map((i) => (isR2Configured() ? headR2Object(i.key) : Promise.resolve(null))),
    );

    const now = new Date();
    const toCreate = fresh.map((i, idx) => {
      const id = identities[idx];
      return {
        batchId,
        title: (i.title && String(i.title).trim()) || titleFromKey(i.key),
        r2Key: i.key,
        sizeBytes: Number.isFinite(i.size) ? Math.round(Number(i.size)) : null,
        fps: batch.defaultFps,
        sourceEtag: id?.etag ?? null,
        sourceSizeBytes: id?.size ?? null,
        sourceLastModified: id?.lastModified ? new Date(id.lastModified) : null,
        sourceVerifiedAt: id?.etag || id?.size ? now : null,
      };
    });

    if (toCreate.length > 0) {
      await prisma.clip.createMany({ data: toCreate });
    }

    return {
      imported: toCreate.length,
      skipped: keys.length - toCreate.length,
    };
  });
}
