import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { handle, badRequest } from "@/lib/api";
import { presignVideoUrl } from "@/lib/r2";

type Ctx = { params: Promise<{ id: string }> };

// Presigned URL for the packed viewer payload + the metadata the viewer needs.
// Reviewers only (the same roles that can approve/reject).
export async function GET(_req: NextRequest, { params }: Ctx) {
  return handle(async () => {
    await requireRole("PLATFORM_ADMIN", "ORG_ADMIN", "QC");
    const { id } = await params;
    const hf = await prisma.handFile.findUnique({ where: { id } });
    if (!hf) badRequest("Hand file not found.");
    if (!hf!.viewerR2Key) badRequest("Viewer payload not available for this file.");
    return {
      url: await presignVideoUrl(hf!.viewerR2Key!),
      title: hf!.title,
      fps: hf!.fps,
      frameCount: hf!.frameCount,
      handCount: hf!.handCount,
      confirmedPct: hf!.confirmedPct,
      droppedFrames: hf!.droppedFrames,
      reviewStatus: hf!.reviewStatus,
      reviewNote: hf!.reviewNote,
    };
  });
}
