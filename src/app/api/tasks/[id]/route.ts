import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { handle, badRequest } from "@/lib/api";
import { getEditableTask } from "@/lib/access";
import { DIFFICULTIES, TASK_QUALITY_FLAGS } from "@/lib/kosha";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Ctx) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await params;
    const { task } = await getEditableTask(user, id);

    const body = await req.json().catch(() => null);
    const data: Record<string, unknown> = {};

    if (body?.startFrame !== undefined) data.startFrame = Math.round(Number(body.startFrame));
    if (body?.endFrame !== undefined) data.endFrame = Math.round(Number(body.endFrame));
    if (body?.label !== undefined) data.label = String(body.label).trim();
    if (body?.notes !== undefined) data.notes = String(body.notes);
    if (body?.venueL2 !== undefined) data.venueL2 = String(body.venueL2);
    if (body?.venueL3 !== undefined) data.venueL3 = String(body.venueL3);
    if (body?.job !== undefined) data.job = String(body.job);

    if (body?.difficulty !== undefined) {
      const d = String(body.difficulty);
      if (d && !DIFFICULTIES.includes(d as (typeof DIFFICULTIES)[number]))
        badRequest("difficulty must be easy | medium | hard.");
      data.difficulty = d;
    }

    if (body?.confidence !== undefined) {
      data.confidence =
        body.confidence === null || body.confidence === ""
          ? null
          : Math.max(0, Math.min(1, Number(body.confidence)));
    }

    if (body?.qualityFlags !== undefined) {
      const flags: string[] = Array.isArray(body.qualityFlags)
        ? body.qualityFlags.map(String)
        : [];
      const bad = flags.filter(
        (f) => !TASK_QUALITY_FLAGS.includes(f as (typeof TASK_QUALITY_FLAGS)[number]),
      );
      if (bad.length) badRequest(`Unknown quality flag(s): ${bad.join(", ")}`);
      data.qualityFlags = JSON.stringify(flags);
    }

    const start = data.startFrame ?? task.startFrame;
    const end = data.endFrame ?? task.endFrame;
    if (Number(end) <= Number(start))
      badRequest("endFrame must be greater than startFrame.");

    const updated = await prisma.task.update({
      where: { id },
      data,
      include: { subTasks: { orderBy: { startFrame: "asc" } } },
    });
    return { task: updated };
  });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await params;
    await getEditableTask(user, id);
    await prisma.task.delete({ where: { id } });
    return { ok: true };
  });
}
