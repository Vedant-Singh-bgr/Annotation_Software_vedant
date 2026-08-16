import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { handle, badRequest } from "@/lib/api";

// Hand-QC batches: named groups for organising hand files. Platform-admin owns
// the hand dataset, so it owns batches too.
export async function GET() {
  return handle(async () => {
    await requireRole("PLATFORM_ADMIN", "ORG_ADMIN");
    const batches = await prisma.handBatch.findMany({
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, _count: { select: { files: true } } },
    });
    return { batches: batches.map((b) => ({ id: b.id, name: b.name, fileCount: b._count.files })) };
  });
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    await requireRole("PLATFORM_ADMIN");
    const body = await req.json().catch(() => null);
    const name = String(body?.name ?? "").trim();
    if (!name) badRequest("A batch name is required.");
    const batch = await prisma.handBatch.create({ data: { name }, select: { id: true, name: true } });
    return { batch };
  });
}
