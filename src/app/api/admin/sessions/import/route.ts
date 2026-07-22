import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { handle, badRequest } from "@/lib/api";
import { isR2Configured, getObjectText } from "@/lib/r2";
import { importSession } from "@/lib/sessions";

// Import one recording session from its manifest.json → a Clip + ClipSegments.
// Accepts either a pasted `manifest` object, or a `manifestKey` to fetch from R2.
export async function POST(req: NextRequest) {
  return handle(async () => {
    await requireRole("PLATFORM_ADMIN");
    const body = await req.json().catch(() => null);

    const batchId = String(body?.batchId ?? "");
    if (!batchId) badRequest("batchId is required.");

    const batch = await prisma.batch.findUnique({
      where: { id: batchId },
      select: { id: true, defaultFps: true },
    });
    if (!batch) badRequest("Batch not found.");

    // Resolve the manifest object from the request or from R2.
    let manifestObj: unknown = body?.manifest ?? null;
    if (!manifestObj) {
      const manifestKey = String(body?.manifestKey ?? "").trim();
      if (!manifestKey) badRequest("Provide a manifest object or a manifestKey.");
      if (!isR2Configured())
        badRequest("R2 is not configured; paste the manifest JSON instead of a key.");
      try {
        manifestObj = JSON.parse(await getObjectText(manifestKey));
      } catch (e) {
        badRequest(`Could not read/parse manifest at ${manifestKey}: ${(e as Error).message}`);
      }
    }

    let result;
    try {
      result = await importSession({
        batchId,
        defaultFps: batch.defaultFps,
        manifest: manifestObj,
        title: String(body?.title ?? ""),
      });
    } catch (e) {
      badRequest((e as Error).message);
    }
    result = result!;

    return {
      clip: { id: result.clipId, title: result.title, sessionId: result.sessionId },
      segments: result.segments,
      updated: result.updated,
    };
  });
}
