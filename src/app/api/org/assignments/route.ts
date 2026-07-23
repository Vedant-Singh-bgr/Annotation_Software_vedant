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

    // Optional QC reviewer. Validated the same way as the annotator: must be an
    // active QC user in this admin's own org.
    const reviewerId = String(body?.reviewerId ?? "") || null;
    if (reviewerId) {
      if (reviewerId === annotatorId)
        badRequest("An annotator cannot review their own work.");
      const reviewer = await prisma.user.findFirst({
        where: {
          id: reviewerId,
          organizationId: admin.organizationId,
          role: "QC",
          active: true,
        },
        select: { id: true },
      });
      if (!reviewer) badRequest("QC reviewer not found in your organization.");
    }

    const existing = await prisma.assignment.findUnique({
      where: { clipId_annotatorId: { clipId, annotatorId } },
    });
    if (existing) return { assignment: existing, alreadyExisted: true };

    const assignment = await prisma.assignment.create({
      data: { clipId, annotatorId, reviewerId },
    });
    return { assignment };
  });
}

// Route, re-route, or clear the QC reviewer on an EXISTING assignment. Separate
// from POST because routing is something an org admin does after the fact, once
// they see who is free — not only at the moment work is handed out.
export async function PATCH(req: NextRequest) {
  return handle(async () => {
    const admin = await requireRole("ORG_ADMIN");
    const body = await req.json().catch(() => null);

    const assignmentId = String(body?.assignmentId ?? "");
    if (!assignmentId) badRequest("assignmentId is required.");
    // null clears the routing, returning the assignment to org-admin review.
    const reviewerId = body?.reviewerId ? String(body.reviewerId) : null;

    const assignment = await prisma.assignment.findFirst({
      where: {
        id: assignmentId,
        clip: { batch: { project: { organizationId: admin.organizationId! } } },
      },
      select: { id: true, annotatorId: true },
    });
    if (!assignment) badRequest("Assignment not found in your organization.");

    if (reviewerId) {
      if (reviewerId === assignment!.annotatorId)
        badRequest("An annotator cannot review their own work.");
      const reviewer = await prisma.user.findFirst({
        where: {
          id: reviewerId,
          organizationId: admin.organizationId,
          role: "QC",
          active: true,
        },
        select: { id: true },
      });
      if (!reviewer) badRequest("QC reviewer not found in your organization.");
    }

    const updated = await prisma.assignment.update({
      where: { id: assignmentId },
      data: { reviewerId },
      select: { id: true, reviewerId: true },
    });
    return { assignment: updated };
  });
}
