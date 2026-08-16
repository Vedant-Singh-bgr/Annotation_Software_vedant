import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { handle, badRequest } from "@/lib/api";
import { presignVideoUrl } from "@/lib/r2";

type Ctx = { params: Promise<{ id: string }> };

// Presigned URLs + metadata the review page needs. Reviewers only (same roles
// that can approve/reject). When the hand file was captured beside a clip, we
// also hand back the paired video and the raw .npz so the page can overlay the
// skeleton on the video (the packed viewer.bin has no camera intrinsics, so the
// on-video projection needs the .npz itself).
export async function GET(_req: NextRequest, { params }: Ctx) {
  return handle(async () => {
    await requireRole("PLATFORM_ADMIN", "ORG_ADMIN", "QC");
    const { id } = await params;
    const hf = await prisma.handFile.findUnique({
      where: { id },
      include: { clip: { select: { r2Key: true, proxyR2Key: true } } },
    });
    if (!hf) badRequest("Hand file not found.");
    if (!hf!.viewerR2Key) badRequest("Viewer payload not available for this file.");

    // Paired video, if this hand file came from a clip with a playable MP4.
    const videoKey = hf!.clip?.proxyR2Key || hf!.clip?.r2Key || null;
    const videoUrl = videoKey ? await presignVideoUrl(videoKey) : null;

    return {
      url: await presignVideoUrl(hf!.viewerR2Key!),
      npzUrl: await presignVideoUrl(hf!.npzR2Key),
      videoUrl,
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
