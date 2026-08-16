import { NextRequest } from "next/server";
import { requireUser, AuthError } from "@/lib/auth";
import { HttpError } from "@/lib/api";
import { getAuthorizedAssignment } from "@/lib/access";
import { getObjectBytes, isR2Configured } from "@/lib/r2";
import { resolveClipHandsKey } from "@/lib/handfiles";

export const runtime = "nodejs";
type Ctx = { params: Promise<{ id: string }> };

function err(status: number, error: string) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// Same-origin proxy for the clip's hand-tracking .npz, streamed to the workspace
// overlay. Avoids the browser needing R2 bucket CORS to fetch a presigned URL.
export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const assignment = await getAuthorizedAssignment(user, id);
    if (!isR2Configured()) return err(404, "No hand file");
    const key = await resolveClipHandsKey({
      r2Key: assignment.clip.r2Key,
      proxyR2Key: assignment.clip.proxyR2Key,
    });
    if (!key) return err(404, "No hand file for this clip");

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
    console.error("[assignment hands data]", e);
    return err(500, "Internal server error");
  }
}
