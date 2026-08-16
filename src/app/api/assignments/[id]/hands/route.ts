import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { handle } from "@/lib/api";
import { getAuthorizedAssignment } from "@/lib/access";
import { isR2Configured } from "@/lib/r2";
import { resolveClipHandsKey } from "@/lib/handfiles";

type Ctx = { params: Promise<{ id: string }> };

// Whether the clip has a hand-tracking .npz beside it in R2, and where the
// workspace should fetch it. The bytes are served by the sibling /data route
// (same-origin proxy) so the browser doesn't need R2 bucket CORS. Returns
// { hands: null } when there's no file. Auth is the same per-assignment check
// every workspace route uses.
export async function GET(_req: NextRequest, { params }: Ctx) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await params;
    const assignment = await getAuthorizedAssignment(user, id);
    if (!isR2Configured()) return { hands: null };

    const key = await resolveClipHandsKey({
      r2Key: assignment.clip.r2Key,
      proxyR2Key: assignment.clip.proxyR2Key,
    });
    if (!key) return { hands: null };
    return { hands: { url: `/api/assignments/${id}/hands/data`, key } };
  });
}
