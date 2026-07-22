import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { handle, badRequest, forbidden } from "@/lib/api";
import { getAuthorizedAssignment } from "@/lib/access";
import { validateSubmission } from "@/lib/validate";
import { parseFlags, sampledFrames } from "@/lib/kosha";
import { publishAssignmentExport } from "@/lib/publish";
import { isR2Configured } from "@/lib/r2";
import type { AssignmentStatus } from "@/lib/constants";

// Run the guideline §6 checklist against an assignment's stored annotations.
async function validateAssignment(assignmentId: string, clip: { fps: number; frameCount: number | null; batch: { sampleEveryN: number } }) {
  const [tasks, qCount] = await Promise.all([
    prisma.task.findMany({
      where: { assignmentId },
      include: { subTasks: true },
    }),
    prisma.frameQuality.count({ where: { assignmentId } }),
  ]);
  const totalQFrames = clip.frameCount
    ? sampledFrames(clip.frameCount, clip.batch.sampleEveryN).length
    : 0;
  return validateSubmission({
    fps: clip.fps,
    tasks: tasks.map((t) => ({
      label: t.label,
      difficulty: t.difficulty,
      venueL2: t.venueL2,
      venueL3: t.venueL3,
      job: t.job,
      qualityFlags: parseFlags(t.qualityFlags),
      startFrame: t.startFrame,
      endFrame: t.endFrame,
      subTasks: t.subTasks.map((s) => ({
        label: s.label,
        description: s.description,
        startFrame: s.startFrame,
        endFrame: s.endFrame,
      })),
    })),
    reviewedQFrames: qCount,
    totalQFrames,
  });
}

type Ctx = { params: Promise<{ id: string }> };

// Annotators submit; org admins/platform admins approve or reject.
export async function POST(req: NextRequest, { params }: Ctx) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await params;
    const assignment = await getAuthorizedAssignment(user, id);

    const body = await req.json().catch(() => null);
    const action = String(body?.action ?? "");
    const reviewNote = String(body?.reviewNote ?? "");

    let next: AssignmentStatus;
    if (action === "submit") {
      if (user.role !== "ANNOTATOR" || assignment.annotatorId !== user.id) {
        forbidden("Only the assigned annotator can submit.");
      }
      // Guideline §6: block submit on structural errors (empty labels, sub-task
      // gaps/overlaps, L1 overlaps). Completeness warnings do not block.
      const { errors } = await validateAssignment(id, assignment.clip);
      if (errors.length > 0) {
        badRequest(
          `Cannot submit — ${errors.length} issue(s): ` +
            errors.slice(0, 6).map((e) => e.message).join(" "),
        );
      }
      next = "SUBMITTED";
    } else if (action === "approve" || action === "reject") {
      if (user.role === "ANNOTATOR") forbidden("Annotators cannot review.");
      next = action === "approve" ? "APPROVED" : "REJECTED";
    } else {
      badRequest("action must be submit | approve | reject.");
    }

    const updated = await prisma.assignment.update({
      where: { id },
      data: {
        status: next!,
        reviewNote: action === "submit" ? assignment.reviewNote : reviewNote,
        submittedAt: action === "submit" ? new Date() : assignment.submittedAt,
      },
    });
    // Approval is the delivery event: publish the export to R2 beside the clip's
    // MP4 proxy. A publish failure must not un-approve the work — it is recorded
    // on the assignment (exportError) and returned as a warning to retry.
    let published: { key: string } | null = null;
    let publishWarning: string | null = null;
    if (next! === "APPROVED" && isR2Configured()) {
      try {
        published = await publishAssignmentExport({ ...assignment, status: next! });
      } catch (err) {
        publishWarning = `Approved, but publishing the export to R2 failed: ${(err as Error).message}`;
      }
    }

    return { assignment: updated, published, publishWarning };
  });
}
