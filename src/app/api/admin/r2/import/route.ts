import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { handle, badRequest } from "@/lib/api";

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

    const toCreate = items
      .filter((i) => i.key && !existingKeys.has(i.key))
      .map((i) => ({
        batchId,
        title: (i.title && String(i.title).trim()) || titleFromKey(i.key),
        r2Key: i.key,
        sizeBytes: Number.isFinite(i.size) ? Math.round(Number(i.size)) : null,
        fps: batch.defaultFps,
      }));

    if (toCreate.length > 0) {
      await prisma.clip.createMany({ data: toCreate });
    }

    return {
      imported: toCreate.length,
      skipped: keys.length - toCreate.length,
    };
  });
}
