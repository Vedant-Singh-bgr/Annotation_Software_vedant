import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { handle } from "@/lib/api";
import { getAuthorizedAssignment } from "@/lib/access";
import { headR2Object, isR2Configured, presignVideoUrl } from "@/lib/r2";

type Ctx = { params: Promise<{ id: string }> };

// Candidate R2 keys for a clip's hand-tracking file, by the same next-to-the-clip
// convention as pre-labels: the video key with the extension swapped for
// `.hands.npz`, or `hands.npz` in the proxy folder for session clips.
function handsKeyCandidates(clip: { r2Key: string | null; proxyR2Key: string | null }): string[] {
  const out: string[] = [];
  if (clip.r2Key) out.push(clip.r2Key.replace(/\.[^./]+$/, "") + ".hands.npz");
  if (clip.proxyR2Key) {
    const dir = clip.proxyR2Key.replace(/\/[^/]*$/, "");
    if (dir) out.push(`${dir}/hands.npz`);
  }
  return out;
}

// Presigned URL for the clip's hand-tracking .npz, if one sits beside it in R2.
// The client fetches + parses it (parseHandNpz) and projects the metric 3D
// joints onto the video. Returns { hands: null } when there's no file — a clip
// without hand tracking simply shows no skeleton. Auth is the same per-assignment
// check every workspace route uses.
export async function GET(_req: NextRequest, { params }: Ctx) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await params;
    const assignment = await getAuthorizedAssignment(user, id);
    if (!isR2Configured()) return { hands: null };

    const clip = assignment.clip;
    for (const key of handsKeyCandidates({ r2Key: clip.r2Key, proxyR2Key: clip.proxyR2Key })) {
      const identity = await headR2Object(key); // never throws; nulls = missing
      if (identity.etag || identity.size != null) {
        return { hands: { url: await presignVideoUrl(key), key } };
      }
    }
    return { hands: null };
  });
}
