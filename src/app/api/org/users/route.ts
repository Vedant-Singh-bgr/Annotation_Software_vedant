import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { hashPassword } from "@/lib/password";
import { handle, badRequest, forbidden } from "@/lib/api";
import { ORG_ASSIGNABLE_ROLES, isOrgAssignableRole } from "@/lib/constants";

// Org admin adds an annotator to their own organization.
export async function POST(req: NextRequest) {
  return handle(async () => {
    const admin = await requireRole("ORG_ADMIN");
    const body = await req.json().catch(() => null);

    const email = String(body?.email ?? "").trim().toLowerCase();
    const name = String(body?.name ?? "").trim();
    const password = String(body?.password ?? "");
    // Validate, don't coerce. This was `role === "ORG_ADMIN" ? ... : "ANNOTATOR"`,
    // which silently turned any other value — including "QC" — into an
    // annotator with no error. PLATFORM_ADMIN is absent from the allowlist, so
    // an org admin still cannot mint one.
    const role = body?.role ?? "ANNOTATOR";
    if (!isOrgAssignableRole(role))
      badRequest(`role must be one of ${ORG_ASSIGNABLE_ROLES.join(", ")}.`);

    if (!email) badRequest("Email is required.");
    if (password.length < 8) badRequest("Password must be at least 8 characters.");

    const dupe = await prisma.user.findUnique({ where: { email } });
    if (dupe) badRequest("A user with that email already exists.");

    const user = await prisma.user.create({
      data: {
        email,
        name: name || email,
        passwordHash: await hashPassword(password),
        role,
        organizationId: admin.organizationId,
      },
      select: { id: true, email: true, name: true, role: true },
    });
    return { user };
  });
}

// Org admin deactivates / reactivates a member of their own organization.
// Soft only — assignments and annotation work are preserved; a deactivated user
// simply can't sign in. Cannot deactivate yourself or someone in another org.
export async function PATCH(req: NextRequest) {
  return handle(async () => {
    const admin = await requireRole("ORG_ADMIN");
    const body = await req.json().catch(() => null);
    const userId = String(body?.userId ?? "");
    const active = Boolean(body?.active);
    if (!userId) badRequest("userId is required.");
    if (userId === admin.id) badRequest("You cannot deactivate your own account.");

    const target = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, organizationId: true, role: true },
    });
    if (!target || target.organizationId !== admin.organizationId) {
      forbidden("That user is not in your organization.");
    }

    // Optional role change, e.g. moving an annotator to QC.
    const nextRole = body?.role;
    const data: { active?: boolean; role?: string } = {};
    if (typeof body?.active === "boolean") data.active = active;

    if (nextRole !== undefined && nextRole !== target!.role) {
      if (!isOrgAssignableRole(nextRole))
        badRequest(`role must be one of ${ORG_ASSIGNABLE_ROLES.join(", ")}.`);
      if (target!.role === "PLATFORM_ADMIN")
        forbidden("A platform admin's role cannot be changed here.");

      // Moving OUT of ANNOTATOR strands any unfinished work: submit requires
      // role ANNOTATOR, and canEditAnnotations denies everyone else, so those
      // assignments become permanently unsubmittable with no exit but a
      // cascading delete. Refuse and say exactly what is blocking, rather than
      // silently creating orphans.
      if (target!.role === "ANNOTATOR" && nextRole !== "ANNOTATOR") {
        const blocking = await prisma.assignment.findMany({
          where: {
            annotatorId: userId,
            status: { in: ["ASSIGNED", "IN_PROGRESS", "REJECTED"] },
          },
          select: { id: true, status: true, clip: { select: { title: true } } },
          take: 20,
        });
        if (blocking.length > 0) {
          badRequest(
            `Cannot change this annotator's role: ${blocking.length} assignment(s) are still open ` +
              `(${blocking
                .slice(0, 3)
                .map((b) => `${b.clip.title} — ${b.status.toLowerCase()}`)
                .join("; ")}${blocking.length > 3 ? "; …" : ""}). ` +
              `Have them submitted and reviewed, or reassign the clips, then try again.`,
          );
        }
      }

      // Don't let the org lock itself out of its own admin surface.
      if (target!.role === "ORG_ADMIN" && nextRole !== "ORG_ADMIN") {
        const others = await prisma.user.count({
          where: {
            organizationId: admin.organizationId,
            role: "ORG_ADMIN",
            active: true,
            id: { not: userId },
          },
        });
        if (others === 0)
          badRequest("This is the organization's only active admin — promote another first.");
      }

      // Someone moving INTO a reviewing role must not keep reviewing duties
      // they can no longer perform, and vice versa: clear stale routing so a
      // demoted QC person doesn't remain the named reviewer on live work.
      if (target!.role === "QC" && nextRole !== "QC") {
        await prisma.assignment.updateMany({
          where: { reviewerId: userId, status: { not: "APPROVED" } },
          data: { reviewerId: null },
        });
      }
      data.role = nextRole;
    }

    if (Object.keys(data).length === 0) badRequest("Nothing to update.");

    const user = await prisma.user.update({
      where: { id: userId },
      data,
      select: { id: true, email: true, name: true, role: true, active: true },
    });
    return { user };
  });
}
