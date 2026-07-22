import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { handle, badRequest } from "@/lib/api";

// Manually add a single clip to a batch (R2 key or fallback source URL). Used in
// demo mode and as a fallback to bucket browsing.
export async function POST(req: NextRequest) {
  return handle(async () => {
    await requireRole("PLATFORM_ADMIN");
    const body = await req.json().catch(() => null);

    const batchId = String(body?.batchId ?? "");
    const title = String(body?.title ?? "").trim();
    const r2Key = String(body?.r2Key ?? "").trim() || null;
    const sourceUrl = String(body?.sourceUrl ?? "").trim() || null;
    const fps = Number(body?.fps);

    if (!batchId) badRequest("batchId is required.");
    if (!title) badRequest("Clip title is required.");
    if (!r2Key && !sourceUrl)
      badRequest("Provide an R2 key or a fallback source URL.");

    const batch = await prisma.batch.findUnique({
      where: { id: batchId },
      select: { defaultFps: true },
    });
    if (!batch) badRequest("Batch not found.");

    const clip = await prisma.clip.create({
      data: {
        batchId,
        title,
        r2Key,
        sourceUrl,
        fps: fps > 0 ? fps : batch.defaultFps,
      },
    });
    return { clip };
  });
}

// Remove a clip (and its assignments/annotations) by id.
export async function DELETE(req: NextRequest) {
  return handle(async () => {
    await requireRole("PLATFORM_ADMIN");
    const id = new URL(req.url).searchParams.get("id");
    if (!id) badRequest("id is required.");
    await prisma.clip.delete({ where: { id } });
    return { ok: true };
  });
}
