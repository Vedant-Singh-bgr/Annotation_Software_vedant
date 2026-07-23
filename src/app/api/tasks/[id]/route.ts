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

    const start = Number(data.startFrame ?? task.startFrame);
    const end = Number(data.endFrame ?? task.endFrame);
    if (end <= start) badRequest("endFrame must be greater than startFrame.");

    // Refuse a span that would leave sub-tasks hanging outside their parent.
    // Nothing checked this, so shrinking a task silently orphaned them — and
    // every later PATCH to such a sub-task, even one only changing its label,
    // was then rejected by the containment check in the sub-task route. The
    // annotator was locked out of their own work with an error that named a
    // span they had not touched.
    if (data.startFrame !== undefined || data.endFrame !== undefined) {
      const outside = await prisma.subTask.findMany({
        where: {
          taskId: id,
          OR: [{ startFrame: { lt: start } }, { endFrame: { gt: end } }],
        },
        select: { label: true, startFrame: true, endFrame: true },
        take: 5,
      });
      if (outside.length > 0)
        badRequest(
          `Task span ${start}–${end} would leave ${outside.length} sub-task(s) outside it ` +
            `(${outside
              .map((s) => `${s.label || "unlabeled"} ${s.startFrame}–${s.endFrame}`)
              .join("; ")}). Trim or delete those sub-tasks first.`,
        );
    }

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
