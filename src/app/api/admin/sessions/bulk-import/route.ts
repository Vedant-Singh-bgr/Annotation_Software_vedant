import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { handle, badRequest } from "@/lib/api";
import { isR2Configured, getObjectText } from "@/lib/r2";
import { importSession } from "@/lib/sessions";
import { triggerTranscode } from "@/lib/transcode";

// Bulk-import many sessions from their R2 manifest keys into one batch, with an
// optional auto-transcode kickoff per imported clip. Per-key failures are
// collected, not fatal, so one bad manifest doesn't abort the whole import.
export async function POST(req: NextRequest) {
  return handle(async () => {
    await requireRole("PLATFORM_ADMIN");
    const body = await req.json().catch(() => null);

    const batchId = String(body?.batchId ?? "");
    const manifestKeys: string[] = Array.isArray(body?.manifestKeys)
      ? body.manifestKeys.map((k: unknown) => String(k)).filter(Boolean)
      : [];
    const autoTranscode = Boolean(body?.autoTranscode);

    if (!batchId) badRequest("batchId is required.");
    if (manifestKeys.length === 0) badRequest("Select at least one session to import.");
    if (!isR2Configured())
      badRequest("R2 is not configured; cannot fetch manifests by key.");

    const batch = await prisma.batch.findUnique({
      where: { id: batchId },
      select: { id: true, defaultFps: true },
    });
    if (!batch) badRequest("Batch not found.");

    let imported = 0;
    let updated = 0;
    let transcodeStarted = 0;
    const failed: { key: string; error: string }[] = [];

    for (const key of manifestKeys) {
      try {
        const manifest = JSON.parse(await getObjectText(key));
        const res = await importSession({ batchId, defaultFps: batch!.defaultFps, manifest });
        if (res.updated) updated++;
        else imported++;
        if (autoTranscode) {
          try {
            await triggerTranscode({ clipId: res.clipId });
            transcodeStarted++;
          } catch (e) {
            failed.push({ key, error: `imported, but couldn't queue transcode: ${(e as Error).message}` });
          }
        }
      } catch (e) {
        failed.push({ key, error: (e as Error).message });
      }
    }

    return { imported, updated, transcodeStarted, failed, total: manifestKeys.length };
  });
}
