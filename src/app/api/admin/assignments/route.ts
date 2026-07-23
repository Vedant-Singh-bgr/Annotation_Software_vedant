import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { handle, badRequest } from "@/lib/api";

// Delete assignments (one or many). Until now nothing in the app could remove an
// assignment at all — the only way out was deleting the whole clip, which took
// the other annotators' assignments with it.
//
// This is destructive: Task, SubTask and FrameQuality all cascade from
// Assignment, so deleting one throws away that annotator's work on the clip. The
// caller is expected to confirm; the counts returned by GET let it say exactly
// how much work is at stake before the user commits.
export async function DELETE(req: NextRequest) {
  return handle(async () => {
    await requireRole("PLATFORM_ADMIN");
    const body = await req.json().catch(() => null);

    const ids: string[] = Array.isArray(body?.assignmentIds)
      ? body.assignmentIds.map((v: unknown) => String(v)).filter(Boolean)
      : [];
    if (ids.length === 0) badRequest("Select at least one assignment.");

    // Report what actually existed rather than trusting the client's list —
    // a stale page can hold ids that are already gone.
    const found = await prisma.assignment.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });
    if (found.length === 0) badRequest("None of those assignments exist any more.");

    const { count } = await prisma.assignment.deleteMany({
      where: { id: { in: found.map((a) => a.id) } },
    });
    return { deleted: count, missing: ids.length - found.length };
  });
}

// How much annotation work a set of assignments holds, so the UI can warn with
// real numbers ("3 assignments · 12 tasks") instead of a generic "are you sure".
export async function POST(req: NextRequest) {
  return handle(async () => {
    await requireRole("PLATFORM_ADMIN");
    const body = await req.json().catch(() => null);

    const ids: string[] = Array.isArray(body?.assignmentIds)
      ? body.assignmentIds.map((v: unknown) => String(v)).filter(Boolean)
      : [];
    if (ids.length === 0) badRequest("Select at least one assignment.");

    const assignments = await prisma.assignment.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        status: true,
        annotator: { select: { name: true } },
        _count: { select: { tasks: true, frameQuality: true } },
      },
    });

    return {
      assignments: assignments.map((a) => ({
        id: a.id,
        status: a.status,
        annotator: a.annotator.name,
        taskCount: a._count.tasks,
        qualityCount: a._count.frameQuality,
      })),
      taskTotal: assignments.reduce((n, a) => n + a._count.tasks, 0),
    };
  });
}
