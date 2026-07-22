import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { handle, badRequest } from "@/lib/api";

// Platform admin creates a project (a body of work assigned to an org).
export async function POST(req: NextRequest) {
  return handle(async () => {
    await requireRole("PLATFORM_ADMIN");
    const body = await req.json().catch(() => null);

    const name = String(body?.name ?? "").trim();
    const organizationId = String(body?.organizationId ?? "");
    const description = String(body?.description ?? "");

    if (!name) badRequest("Project name is required.");
    if (!organizationId) badRequest("You must choose an organization.");

    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true },
    });
    if (!org) badRequest("Organization not found.");

    const project = await prisma.project.create({
      data: { name, description, organizationId },
    });
    return { project };
  });
}
