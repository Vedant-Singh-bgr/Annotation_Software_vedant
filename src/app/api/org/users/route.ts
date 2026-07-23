import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { hashPassword } from "@/lib/password";
import { handle, badRequest, forbidden } from "@/lib/api";

// Org admin adds an annotator to their own organization.
export async function POST(req: NextRequest) {
  return handle(async () => {
    const admin = await requireRole("ORG_ADMIN");
    const body = await req.json().catch(() => null);

    const email = String(body?.email ?? "").trim().toLowerCase();
    const name = String(body?.name ?? "").trim();
    const password = String(body?.password ?? "");
    const role = body?.role === "ORG_ADMIN" ? "ORG_ADMIN" : "ANNOTATOR";

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
      select: { id: true, organizationId: true },
    });
    if (!target || target.organizationId !== admin.organizationId) {
      forbidden("That user is not in your organization.");
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data: { active },
      select: { id: true, email: true, name: true, role: true, active: true },
    });
    return { user };
  });
}
