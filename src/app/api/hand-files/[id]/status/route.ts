import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { handle, badRequest, forbidden } from "@/lib/api";
import { isR2Configured, putObjectJson } from "@/lib/r2";

type Ctx = { params: Promise<{ id: string }> };

// R2 key for a hand file's QC verdict: beside the .npz (…/foo.npz -> …/foo.qc.json),
// mirroring how an annotation export lands beside the clip's MP4.
function qcKeyFor(npzR2Key: string): string {
  return npzR2Key.replace(/\.npz$/i, "") + ".qc.json";
}

// File-level QC verdict: approve or reject the hand file with a note. Same
// reviewer allowlist as the annotation review path. Records who and when, and —
// like annotation publish — writes the verdict JSON to R2 beside the .npz so the
// decision is delivered, not just held in the DB. The R2 write is best-effort:
// a delivery failure never blocks the review from being recorded.
export async function POST(req: NextRequest, { params }: Ctx) {
  return handle(async () => {
    const user = await requireRole("PLATFORM_ADMIN", "ORG_ADMIN", "QC");
    const { id } = await params;
    const body = await req.json().catch(() => null);
    const action = String(body?.action ?? "");
    const reviewNote = String(body?.reviewNote ?? "");
    if (action !== "approve" && action !== "reject")
      badRequest("action must be approve | reject.");

    const hf = await prisma.handFile.findUnique({ where: { id } });
    if (!hf) badRequest("Hand file not found.");
    // A QC reviewer may only act on files routed to them; admins are unrestricted.
    if (user.role === "QC" && hf!.reviewerId && hf!.reviewerId !== user.id)
      forbidden("This hand file has not been routed to you for review.");

    const reviewStatus = action === "approve" ? "APPROVED" : "REJECTED";
    const reviewedAt = new Date();
    const updated = await prisma.handFile.update({
      where: { id },
      data: { reviewStatus, reviewNote, reviewedById: user.id, reviewedAt },
      select: { id: true, reviewStatus: true, reviewNote: true },
    });

    // Deliver the verdict beside the .npz. Best-effort.
    let exported: { key: string } | null = null;
    let exportError: string | null = null;
    if (isR2Configured()) {
      const key = qcKeyFor(hf!.npzR2Key);
      try {
        await putObjectJson(key, {
          kind: "hand-qc-verdict",
          handFileId: hf!.id,
          title: hf!.title,
          npz_r2_key: hf!.npzR2Key,
          viewer_r2_key: hf!.viewerR2Key ?? null,
          review_status: reviewStatus,
          review_note: reviewNote,
          reviewed_by: user.email ?? user.id,
          reviewed_at: reviewedAt.toISOString(),
          signals: {
            fps: hf!.fps,
            frame_count: hf!.frameCount,
            hand_count: hf!.handCount,
            confirmed_pct: hf!.confirmedPct,
            dropped_frames: hf!.droppedFrames,
          },
          // Source identity, so a consumer can verify the .npz these labels
          // describe hasn't changed (same pattern as the annotation export).
          source_etag: hf!.sourceEtag ?? null,
          source_verified_at: hf!.sourceVerifiedAt?.toISOString() ?? null,
          exported_at: reviewedAt.toISOString(),
        });
        exported = { key };
      } catch (e) {
        exportError = (e as Error).message;
      }
    }

    return { handFile: updated, export: exported, exportError };
  });
}
