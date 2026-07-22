import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { handle, badRequest } from "@/lib/api";

type Ctx = { params: Promise<{ id: string }> };

// Lightweight clip status, for the admin UI to poll while a transcode runs.
export async function GET(_req: NextRequest, { params }: Ctx) {
  return handle(async () => {
    await requireRole("PLATFORM_ADMIN");
    const { id } = await params;
    const clip = await prisma.clip.findUnique({
      where: { id },
      select: { id: true, proxyStatus: true, proxyError: true, frameCount: true, fps: true },
    });
    if (!clip) badRequest("Clip not found.");
    return clip;
  });
}
