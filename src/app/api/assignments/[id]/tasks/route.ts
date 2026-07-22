import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { handle, badRequest } from "@/lib/api";
import { getAuthorizedAssignment, canEditAnnotations } from "@/lib/access";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await params;
    await getAuthorizedAssignment(user, id);
    const tasks = await prisma.task.findMany({
      where: { assignmentId: id },
      orderBy: { startFrame: "asc" },
      include: { subTasks: { orderBy: { startFrame: "asc" } } },
    });
    return { tasks };
  });
}

// Create an L1 task with frame boundaries.
export async function POST(req: NextRequest, { params }: Ctx) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await params;
    const assignment = await getAuthorizedAssignment(user, id);
    if (!canEditAnnotations(user, assignment)) {
      badRequest("You cannot edit this task (not owner, or it is approved).");
    }

    const body = await req.json().catch(() => null);
    const startFrame = Math.round(Number(body?.startFrame));
    const endFrame = Math.round(Number(body?.endFrame));
    if (!Number.isFinite(startFrame) || !Number.isFinite(endFrame))
      badRequest("startFrame/endFrame must be numbers.");
    if (startFrame < 0) badRequest("startFrame must be ≥ 0.");
    if (endFrame <= startFrame) badRequest("endFrame must be greater than startFrame.");

    const count = await prisma.task.count({ where: { assignmentId: id } });
    const created = await prisma.$transaction(async (tx) => {
      const task = await tx.task.create({
        data: {
          assignmentId: id,
          orderIndex: count,
          startFrame,
          endFrame,
          createdById: user.id,
        },
        include: { subTasks: true },
      });
      if (assignment.status === "ASSIGNED") {
        await tx.assignment.update({
          where: { id },
          data: { status: "IN_PROGRESS" },
        });
      }
      return task;
    });
    return { task: created };
  });
}
