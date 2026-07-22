import { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth";
import { handle, badRequest } from "@/lib/api";
import { triggerTranscode } from "@/lib/transcode";

type Ctx = { params: Promise<{ id: string }> };

// Queue the MCAP -> MP4 proxy transcode. The standalone worker
// (scripts/transcode_worker.py) does the actual work. See lib/transcode.ts.
export async function POST(_req: NextRequest, { params }: Ctx) {
  return handle(async () => {
    await requireRole("PLATFORM_ADMIN");
    const { id } = await params;
    try {
      const { proxyKey } = await triggerTranscode({ clipId: id });
      return { ok: true, clipId: id, proxyStatus: "queued", proxyKey };
    } catch (e) {
      badRequest((e as Error).message);
    }
  });
}
