import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { handle, badRequest } from "@/lib/api";
import { TAXONOMY_TYPES, type TaxonomyType } from "@/lib/kosha";

// List all approved-list items (global). Platform admin manages these.
export async function GET() {
  return handle(async () => {
    await requireRole("PLATFORM_ADMIN", "ORG_ADMIN");
    const items = await prisma.taxonomyItem.findMany({
      orderBy: [{ type: "asc" }, { sortOrder: "asc" }, { value: "asc" }],
    });
    return { items };
  });
}

// Add an approved-list value.
export async function POST(req: NextRequest) {
  return handle(async () => {
    await requireRole("PLATFORM_ADMIN");
    const body = await req.json().catch(() => null);
    const type = String(body?.type ?? "") as TaxonomyType;
    const value = String(body?.value ?? "").trim();

    if (!TAXONOMY_TYPES.includes(type)) badRequest("Invalid taxonomy type.");
    if (!value) badRequest("Value is required.");

    const exists = await prisma.taxonomyItem.findFirst({
      where: { type, value, projectId: null },
    });
    if (exists) badRequest("That value already exists in this list.");

    const count = await prisma.taxonomyItem.count({ where: { type } });
    const item = await prisma.taxonomyItem.create({
      data: { type, value, sortOrder: count },
    });
    return { item };
  });
}
