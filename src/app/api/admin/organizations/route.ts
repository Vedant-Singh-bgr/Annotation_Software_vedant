import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { hashPassword } from "@/lib/password";
import { handle, badRequest } from "@/lib/api";

function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

// Platform admin creates an annotation company and (optionally) its first admin.
export async function POST(req: NextRequest) {
  return handle(async () => {
    await requireRole("PLATFORM_ADMIN");
    const body = await req.json().catch(() => null);

    const name = String(body?.name ?? "").trim();
    if (!name) badRequest("Organization name is required.");
    const slug = slugify(name);

    const exists = await prisma.organization.findUnique({ where: { slug } });
    if (exists) badRequest("An organization with a similar name already exists.");

    const adminEmail = String(body?.adminEmail ?? "").trim().toLowerCase();
    const adminName = String(body?.adminName ?? "").trim();
    const adminPassword = String(body?.adminPassword ?? "");

    const org = await prisma.$transaction(async (tx) => {
      const created = await tx.organization.create({ data: { name, slug } });
      if (adminEmail) {
        if (adminPassword.length < 8)
          badRequest("Admin password must be at least 8 characters.");
        const dupe = await tx.user.findUnique({ where: { email: adminEmail } });
        if (dupe) badRequest("A user with that email already exists.");
        await tx.user.create({
          data: {
            email: adminEmail,
            name: adminName || adminEmail,
            passwordHash: await hashPassword(adminPassword),
            role: "ORG_ADMIN",
            organizationId: created.id,
          },
        });
      }
      return created;
    });

    return { organization: org };
  });
}

// Platform admin archives / restores an organization. Soft only — archiving
// locks out all of the org's users (they can't sign in) but preserves every
// project, clip, and annotation. Restoring re-enables them.
export async function PATCH(req: NextRequest) {
  return handle(async () => {
    await requireRole("PLATFORM_ADMIN");
    const body = await req.json().catch(() => null);
    const orgId = String(body?.orgId ?? "");
    const active = Boolean(body?.active);
    if (!orgId) badRequest("orgId is required.");

    const organization = await prisma.organization.update({
      where: { id: orgId },
      data: { active },
      select: { id: true, name: true, active: true },
    });
    return { organization };
  });
}
