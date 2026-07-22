import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { handle, badRequest } from "@/lib/api";

// Org admin assigns a clip (within their org's project) to one of their
// annotators. Idempotent per (clip, annotator).
export async function POST(req: NextRequest) {
  return handle(async () => {
    const admin = await requireRole("ORG_ADMIN");
    const body = await req.json().catch(() => null);

    const clipId = String(body?.clipId ?? "");
    const annotatorId = String(body?.annotatorId ?? "");
    if (!clipId || !annotatorId)
      badRequest("clipId and annotatorId are required.");

    // Both must belong to the admin's org.
    const clip = await prisma.clip.findFirst({
      where: {
        id: clipId,
        batch: { project: { organizationId: admin.organizationId! } },
      },
      select: { id: true },
    });
    if (!clip) badRequest("Clip not found in your organization.");

    const annotator = await prisma.user.findFirst({
      where: {
        id: annotatorId,
        organizationId: admin.organizationId,
        role: "ANNOTATOR",
      },
      select: { id: true },
    });
    if (!annotator) badRequest("Annotator not found in your organization.");

    const existing = await prisma.assignment.findUnique({
      where: { clipId_annotatorId: { clipId, annotatorId } },
    });
    if (existing) return { assignment: existing, alreadyExisted: true };

    const assignment = await prisma.assignment.create({
      data: { clipId, annotatorId },
    });
    return { assignment };
  });
}
