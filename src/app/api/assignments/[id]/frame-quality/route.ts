import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { handle, badRequest } from "@/lib/api";
import { getAuthorizedAssignment, canEditAnnotations } from "@/lib/access";

type Ctx = { params: Promise<{ id: string }> };

const BOOL_FLAGS = ["realWork", "repetitive", "occluded", "smudge", "glare", "blur"] as const;

// Upsert the quality flags for one sampled frame.
export async function PUT(req: NextRequest, { params }: Ctx) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await params;
    const assignment = await getAuthorizedAssignment(user, id);
    if (!canEditAnnotations(user, assignment)) {
      badRequest("You cannot edit this task.");
    }

    const body = await req.json().catch(() => null);
    const frameIndex = Math.round(Number(body?.frameIndex));
    if (!Number.isFinite(frameIndex) || frameIndex < 0)
      badRequest("frameIndex must be a non-negative integer.");

    const flags: Record<string, boolean> = {};
    for (const f of BOOL_FLAGS) {
      if (body?.[f] !== undefined) flags[f] = Boolean(body[f]);
    }
    const note = body?.notes !== undefined ? String(body.notes) : undefined;

    const row = await prisma.frameQuality.upsert({
      where: { assignmentId_frameIndex: { assignmentId: id, frameIndex } },
      update: { ...flags, ...(note !== undefined ? { notes: note } : {}) },
      create: {
        assignmentId: id,
        frameIndex,
        createdById: user.id,
        ...flags,
        ...(note !== undefined ? { notes: note } : {}),
      },
    });
    return { frameQuality: row };
  });
}
