import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { handle, badRequest } from "@/lib/api";
import { getEditableTask } from "@/lib/access";

type Ctx = { params: Promise<{ id: string }> };

// Create an L2 sub-task inside a task. Bounds must fall within the parent span.
export async function POST(req: NextRequest, { params }: Ctx) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await params;
    const { task } = await getEditableTask(user, id);

    const body = await req.json().catch(() => null);
    const startFrame = Math.round(Number(body?.startFrame));
    const endFrame = Math.round(Number(body?.endFrame));
    if (!Number.isFinite(startFrame) || !Number.isFinite(endFrame))
      badRequest("startFrame/endFrame must be numbers.");
    if (endFrame <= startFrame)
      badRequest("endFrame must be greater than startFrame.");
    if (startFrame < task.startFrame || endFrame > task.endFrame)
      badRequest(
        `Sub-task must stay within the task span (${task.startFrame}–${task.endFrame}).`,
      );

    const count = await prisma.subTask.count({ where: { taskId: id } });
    const subTask = await prisma.subTask.create({
      data: {
        taskId: id,
        orderIndex: count,
        startFrame,
        endFrame,
        label: String(body?.label ?? "").trim(),
        description: String(body?.description ?? ""),
        objectLeft: String(body?.objectLeft ?? ""),
        objectRight: String(body?.objectRight ?? ""),
        createdById: user.id,
      },
    });
    return { subTask };
  });
}
