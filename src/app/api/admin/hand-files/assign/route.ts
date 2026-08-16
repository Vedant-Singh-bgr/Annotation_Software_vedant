import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { handle, badRequest } from "@/lib/api";

// Route a batch of hand files to a QC reviewer (or clear the routing with a null
// reviewerId), the hand-QC analogue of routing an annotation Assignment. The
// reviewer's Hand QC queue then shows exactly the files assigned to them.
export async function POST(req: NextRequest) {
  return handle(async () => {
    await requireRole("PLATFORM_ADMIN", "ORG_ADMIN");
    const body = await req.json().catch(() => null);

    const ids: string[] = Array.isArray(body?.ids) ? body.ids.map(String).filter(Boolean) : [];
    if (ids.length === 0) badRequest("Select at least one hand file.");
    const reviewerId: string | null = body?.reviewerId ? String(body.reviewerId) : null;

    if (reviewerId) {
      const reviewer = await prisma.user.findFirst({
        where: { id: reviewerId, role: "QC", active: true },
        select: { id: true },
      });
      if (!reviewer) badRequest("Pick an active QC reviewer.");
    }

    const { count } = await prisma.handFile.updateMany({
      where: { id: { in: ids } },
      data: { reviewerId },
    });
    return { assigned: count, reviewerId };
  });
}
