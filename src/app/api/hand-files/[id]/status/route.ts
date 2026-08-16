import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { handle, badRequest } from "@/lib/api";

type Ctx = { params: Promise<{ id: string }> };

// File-level QC verdict: approve or reject the hand file with a note. Same
// reviewer allowlist as the annotation review path. Records who and when.
export async function POST(req: NextRequest, { params }: Ctx) {
  return handle(async () => {
    const user = await requireRole("PLATFORM_ADMIN", "ORG_ADMIN", "QC");
    const { id } = await params;
    const body = await req.json().catch(() => null);
    const action = String(body?.action ?? "");
    const reviewNote = String(body?.reviewNote ?? "");
    if (action !== "approve" && action !== "reject")
      badRequest("action must be approve | reject.");

    const hf = await prisma.handFile.findUnique({ where: { id }, select: { id: true } });
    if (!hf) badRequest("Hand file not found.");

    const updated = await prisma.handFile.update({
      where: { id },
      data: {
        reviewStatus: action === "approve" ? "APPROVED" : "REJECTED",
        reviewNote,
        reviewedById: user.id,
        reviewedAt: new Date(),
      },
      select: { id: true, reviewStatus: true, reviewNote: true },
    });
    return { handFile: updated };
  });
}
