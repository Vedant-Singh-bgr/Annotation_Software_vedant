import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { hashPassword } from "@/lib/password";
import { handle, badRequest } from "@/lib/api";

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
