import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireRole, AuthError } from "@/lib/auth";
import { HttpError } from "@/lib/api";
import { getObjectBytes } from "@/lib/r2";

export const runtime = "nodejs";
type Ctx = { params: Promise<{ id: string }> };

function err(status: number, error: string) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// Same-origin proxy for a hand file's bytes (viewer payload or raw .npz). The
// browser can't fetch presigned R2 URLs directly without bucket CORS; streaming
// through the app keeps it same-origin and works against any bucket. Small files
// (≈1–3 MB), reviewers only.
export async function GET(req: NextRequest, { params }: Ctx) {
  try {
    await requireRole("PLATFORM_ADMIN", "ORG_ADMIN", "QC");
    const { id } = await params;
    const kind = new URL(req.url).searchParams.get("kind") || "viewer";
    const hf = await prisma.handFile.findUnique({
      where: { id },
      select: { viewerR2Key: true, npzR2Key: true },
    });
    if (!hf) return err(404, "Hand file not found");
    const key = kind === "npz" ? hf.npzR2Key : hf.viewerR2Key;
    if (!key) return err(404, "Not available");

    const bytes = await getObjectBytes(key);
    // Cast: the SDK's byte array is typed over ArrayBufferLike, which BodyInit's
    // types reject, though undici accepts a Uint8Array body fine at runtime.
    return new Response(bytes as unknown as BodyInit, {
      headers: {
        "content-type": "application/octet-stream",
        "cache-control": "private, max-age=300",
      },
    });
  } catch (e) {
    if (e instanceof AuthError || e instanceof HttpError) return err(e.status, e.message);
    console.error("[hand-file data]", e);
    return err(500, "Internal server error");
  }
}
