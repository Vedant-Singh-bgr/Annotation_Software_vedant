import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { verifyPassword } from "@/lib/password";
import { createSession } from "@/lib/auth";
import { handle, badRequest, HttpError } from "@/lib/api";

export async function POST(req: NextRequest) {
  return handle(async () => {
    const body = await req.json().catch(() => null);
    const email = String(body?.email ?? "").trim().toLowerCase();
    const password = String(body?.password ?? "");
    if (!email || !password) badRequest("Email and password are required.");

    const user = await prisma.user.findUnique({
      where: { email },
      include: { organization: { select: { active: true } } },
    });
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      throw new HttpError(401, "Invalid email or password.");
    }
    if (!user.active || (user.organization && !user.organization.active)) {
      throw new HttpError(403, "This account has been deactivated. Contact your administrator.");
    }

    await createSession(user);
    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    };
  });
}
