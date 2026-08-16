import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { handle, badRequest } from "@/lib/api";
import { headR2Object, presignVideoUrl } from "@/lib/r2";
import { videoKeyForHandsKey } from "@/lib/handfiles";

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

    // Paired video: from the linked clip, or the video key captured beside the
    // .npz on a standalone Hand QC import.
    let videoKey = hf!.clip?.proxyR2Key || hf!.clip?.r2Key || hf!.videoR2Key || null;
    // Self-heal records imported before videoR2Key existed: detect the sibling
    // .mp4 by convention and persist it, so old hand files gain the overlay.
    if (!videoKey) {
      const candidate = videoKeyForHandsKey(hf!.npzR2Key);
      const h = await headR2Object(candidate);
      if (h.etag || h.size != null) {
        videoKey = candidate;
        await prisma.handFile.update({ where: { id }, data: { videoR2Key: candidate } }).catch(() => {});
      }
    }
    const videoUrl = videoKey ? await presignVideoUrl(videoKey) : null;

    return {
      // Bytes are proxied same-origin (browser can't fetch presigned R2 without
      // bucket CORS). The video plays fine from a presigned URL — media elements
      // don't enforce CORS for playback.
      url: `/api/hand-files/${id}/data?kind=viewer`,
      npzUrl: `/api/hand-files/${id}/data?kind=npz`,
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
