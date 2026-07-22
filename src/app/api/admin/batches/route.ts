import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { handle, badRequest } from "@/lib/api";
import { DEFAULT_FPS, DEFAULT_SAMPLE_EVERY_N } from "@/lib/kosha";

// Platform admin creates a batch (an R2 import target) under a project.
export async function POST(req: NextRequest) {
  return handle(async () => {
    await requireRole("PLATFORM_ADMIN");
    const body = await req.json().catch(() => null);

    const projectId = String(body?.projectId ?? "");
    const name = String(body?.name ?? "").trim();
    const r2Prefix = String(body?.r2Prefix ?? "").trim();
    const sampleEveryN = Number(body?.sampleEveryN ?? DEFAULT_SAMPLE_EVERY_N);
    const defaultFps = Number(body?.defaultFps ?? DEFAULT_FPS);

    if (!projectId) badRequest("projectId is required.");
    if (!name) badRequest("Batch name is required.");
    if (!Number.isInteger(sampleEveryN) || sampleEveryN < 1)
      badRequest("sampleEveryN must be a positive integer.");
    if (!(defaultFps > 0)) badRequest("defaultFps must be > 0.");

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true },
    });
    if (!project) badRequest("Project not found.");

    const batch = await prisma.batch.create({
      data: { projectId, name, r2Prefix, sampleEveryN, defaultFps },
    });
    return { batch };
  });
}
