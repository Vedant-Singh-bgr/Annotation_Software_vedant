import { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth";
import { handle, badRequest } from "@/lib/api";
import { triggerTranscode } from "@/lib/transcode";

type Ctx = { params: Promise<{ id: string }> };

// Queue the MCAP -> MP4 proxy transcode. The standalone worker
// (scripts/transcode_worker.py) does the actual work. See lib/transcode.ts.
export async function POST(req: NextRequest, { params }: Ctx) {
  return handle(async () => {
    await requireRole("PLATFORM_ADMIN");
    const { id } = await params;
    // force: clear a clip stuck in queued/transcoding because its worker was
    // killed mid-job and never reported back.
    const body = await req.json().catch(() => null);
    const force = Boolean(body?.force);
    try {
      const { proxyKey } = await triggerTranscode({ clipId: id, force });
      return { ok: true, clipId: id, proxyStatus: "queued", proxyKey };
    } catch (e) {
      badRequest((e as Error).message);
    }
  });
}
