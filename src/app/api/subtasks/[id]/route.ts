import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { handle, badRequest } from "@/lib/api";
import { getEditableSubTask } from "@/lib/access";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Ctx) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await params;
    const { subTask } = await getEditableSubTask(user, id);
    const task = subTask.task;

    const body = await req.json().catch(() => null);
    const data: Record<string, unknown> = {};

    if (body?.startFrame !== undefined) data.startFrame = Math.round(Number(body.startFrame));
    if (body?.endFrame !== undefined) data.endFrame = Math.round(Number(body.endFrame));
    if (body?.label !== undefined) data.label = String(body.label).trim();
    if (body?.description !== undefined) data.description = String(body.description);
    if (body?.objectLeft !== undefined) data.objectLeft = String(body.objectLeft);
    if (body?.objectRight !== undefined) data.objectRight = String(body.objectRight);
    if (body?.notes !== undefined) data.notes = String(body.notes);
    if (body?.confidence !== undefined) {
      data.confidence =
        body.confidence === null || body.confidence === ""
          ? null
          : Math.max(0, Math.min(1, Number(body.confidence)));
    }

    const start = Number(data.startFrame ?? subTask.startFrame);
    const end = Number(data.endFrame ?? subTask.endFrame);
    if (end <= start) badRequest("endFrame must be greater than startFrame.");
    if (start < task.startFrame || end > task.endFrame)
      badRequest(
        `Sub-task must stay within the task span (${task.startFrame}–${task.endFrame}).`,
      );

    const updated = await prisma.subTask.update({ where: { id }, data });
    return { subTask: updated };
  });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await params;
    await getEditableSubTask(user, id);
    await prisma.subTask.delete({ where: { id } });
    return { ok: true };
  });
}
