import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { handle, badRequest, forbidden } from "@/lib/api";
import { isR2Configured, presignVideoUrl } from "@/lib/r2";

type Ctx = { params: Promise<{ id: string }> };

// Ingest the result of scripts/render_overlay.py for one assignment, and hand
// out a playback URL for the finished overlay.
//
// Callers:
//   * render_overlay.py --report-url (machine) — auth via x-transcode-secret;
//   * the admin overlay gallery (human) — auth via session cookie.
async function authorize(req: NextRequest): Promise<void> {
  const secret = process.env.TRANSCODE_SECRET;
  const header = req.headers.get("x-transcode-secret");
  if (secret && header && header === secret) return; // machine caller
  const user = await getSession();
  if (user?.role === "PLATFORM_ADMIN") return; // human caller
  forbidden("A platform-admin session or a valid x-transcode-secret is required.");
}

export async function POST(req: NextRequest, { params }: Ctx) {
  return handle(async () => {
    await authorize(req);
    const { id } = await params;

    const assignment = await prisma.assignment.findUnique({ where: { id } });
    if (!assignment) badRequest("Assignment not found.");

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) badRequest("Body must be JSON.");

    if (body.status === "failed") {
      await prisma.assignment.update({
        where: { id },
        data: {
          overlayStatus: "failed",
          overlayError: String(body.error ?? "overlay render failed"),
        },
      });
      return { ok: true, overlayStatus: "failed" };
    }

    const key =
      (typeof body.uploaded_key === "string" && body.uploaded_key.trim()) || null;
    if (!key)
      badRequest("Overlay metadata has no uploaded_key — nothing was written to R2.");

    await prisma.assignment.update({
      where: { id },
      data: {
        overlayR2Key: key,
        overlayStatus: "ready",
        overlayError: null,
        overlayRenderedAt: new Date(),
      },
    });
    return { ok: true, overlayStatus: "ready", overlayR2Key: key };
  });
}

// Presigned playback URL for a finished overlay. Minted on demand rather than
// stored, so links can't outlive their TTL in the page.
export async function GET(req: NextRequest, { params }: Ctx) {
  return handle(async () => {
    await authorize(req);
    const { id } = await params;

    const assignment = await prisma.assignment.findUnique({
      where: { id },
      select: { overlayR2Key: true, overlayStatus: true },
    });
    if (!assignment) badRequest("Assignment not found.");
    if (!assignment.overlayR2Key)
      badRequest("This assignment has no rendered overlay yet.");
    if (!isR2Configured()) badRequest("R2 is not configured.");

    return {
      url: await presignVideoUrl(assignment.overlayR2Key),
      overlayStatus: assignment.overlayStatus,
    };
  });
}

// Re-queue a render (after a correction, or to switch original <-> proxy).
export async function PATCH(req: NextRequest, { params }: Ctx) {
  return handle(async () => {
    await authorize(req);
    const { id } = await params;

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const source = body?.source === "proxy" ? "proxy" : "original";

    const assignment = await prisma.assignment.findUnique({
      where: { id },
      select: { status: true, exportR2Key: true },
    });
    if (!assignment) badRequest("Assignment not found.");
    // Approval is the delivery gate everywhere else; an overlay is a delivered
    // artefact, so it holds here too.
    if (assignment.status !== "APPROVED")
      badRequest("Only approved assignments can be rendered.");
    if (!assignment.exportR2Key)
      badRequest("Publish the assignment first — the render reads its export JSON from R2.");

    await prisma.assignment.update({
      where: { id },
      data: { overlayStatus: "queued", overlayError: null, overlaySource: source },
    });
    return { ok: true, overlayStatus: "queued", overlaySource: source };
  });
}
