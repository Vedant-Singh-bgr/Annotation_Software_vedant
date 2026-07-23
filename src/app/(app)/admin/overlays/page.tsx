import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isR2Configured } from "@/lib/r2";
import OverlayGallery from "./OverlayGallery";

// Delivered overlays: approved assignments whose labels have been burned onto
// the video. Approval is the delivery gate everywhere in the platform, so only
// APPROVED work appears here — this page is the shelf of finished artefacts, not
// a work queue.
export default async function OverlaysPage() {
  const user = (await getSession())!;
  if (user.role !== "PLATFORM_ADMIN") redirect("/dashboard");

  const assignments = await prisma.assignment.findMany({
    where: { status: "APPROVED" },
    include: {
      annotator: { select: { name: true } },
      clip: {
        select: {
          title: true,
          sessionId: true,
          r2Key: true,
          proxyR2Key: true,
          batch: { select: { name: true, project: { select: { name: true } } } },
        },
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  return (
    <div>
      <h1 className="mb-1 font-serif text-2xl font-medium text-ink-900">Overlay clips</h1>
      <p className="mb-6 max-w-2xl text-sm text-ink-500">
        Approved annotations burned onto their video — one watchable MP4 per
        assignment, playable without the platform. Queued automatically when you
        publish. Rendered onto the original upload by default; switch to the
        proxy for a smaller file (the labels line up on either, since both carry
        identical frame numbering).
      </p>

      <OverlayGallery
        r2Configured={isR2Configured()}
        rows={assignments.map((a) => ({
          id: a.id,
          annotator: a.annotator.name,
          clipTitle: a.clip.title,
          project: a.clip.batch.project.name,
          batch: a.clip.batch.name,
          isSession: Boolean(a.clip.sessionId),
          hasOriginal: Boolean(a.clip.r2Key),
          hasProxy: Boolean(a.clip.proxyR2Key),
          exportR2Key: a.exportR2Key,
          overlayStatus: a.overlayStatus,
          overlayR2Key: a.overlayR2Key,
          overlayError: a.overlayError,
          overlaySource: a.overlaySource,
          overlayRenderedAt: a.overlayRenderedAt?.toISOString() ?? null,
        }))}
      />
    </div>
  );
}
