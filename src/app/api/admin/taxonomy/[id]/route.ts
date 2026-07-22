import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { handle } from "@/lib/api";

type Ctx = { params: Promise<{ id: string }> };

// Toggle active / rename an approved-list item.
export async function PATCH(req: NextRequest, { params }: Ctx) {
  return handle(async () => {
    await requireRole("PLATFORM_ADMIN");
    const { id } = await params;
    const body = await req.json().catch(() => null);
    const data: Record<string, unknown> = {};
    if (typeof body?.active === "boolean") data.active = body.active;
    if (body?.value !== undefined) data.value = String(body.value).trim();
    const item = await prisma.taxonomyItem.update({ where: { id }, data });
    return { item };
  });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  return handle(async () => {
    await requireRole("PLATFORM_ADMIN");
    const { id } = await params;
    await prisma.taxonomyItem.delete({ where: { id } });
    return { ok: true };
  });
}
