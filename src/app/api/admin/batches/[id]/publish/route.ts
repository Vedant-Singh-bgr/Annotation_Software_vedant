import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { handle, forbidden, notFound } from "@/lib/api";
import { publishBatchExports } from "@/lib/publish";

type Ctx = { params: Promise<{ id: string }> };

// Publish every APPROVED assignment in a batch to R2 and write the batch
// manifest. Platform admin may publish any batch; org admin only their own org.
export async function POST(_req: NextRequest, { params }: Ctx) {
  return handle(async () => {
    const user = await requireRole("PLATFORM_ADMIN", "ORG_ADMIN");
    const { id } = await params;

    const batch = await prisma.batch.findUnique({
      where: { id },
      select: { id: true, project: { select: { organizationId: true } } },
    });
    if (!batch) notFound("Batch not found");
    if (user.role === "ORG_ADMIN" && batch.project.organizationId !== user.organizationId) {
      forbidden("This batch belongs to another organization.");
    }

    const result = await publishBatchExports(id);
    return result;
  });
}
