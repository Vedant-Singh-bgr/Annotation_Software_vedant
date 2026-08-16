import { prisma } from "@/lib/db";
import { getObjectBytes, putObjectBytes, headR2Object } from "@/lib/r2";
import { parseHandNpz, packViewer } from "@/lib/npz";

// Capture one hand-tracking .npz from R2 as a HandFile: fetch, parse, write the
// compact viewer payload beside it, read the source identity, create the row.
// Idempotent by npzR2Key — re-capturing returns the existing id. Optionally links
// the clip it was found next to (so the Hand QC review page can load the video).
//
// Shared by the manual hands/-prefix import and the auto-capture that runs when a
// clip is imported and a sibling <clip>.hands.npz exists.
export async function captureHandFile(opts: {
  npzKey: string;
  clipId?: string | null;
  title?: string;
}): Promise<{ ok: true; id: string; alreadyExisted: boolean } | { ok: false; error: string }> {
  const { npzKey } = opts;
  try {
    const existing = await prisma.handFile.findUnique({
      where: { npzR2Key: npzKey },
      select: { id: true, clipId: true, videoR2Key: true },
    });
    // The paired video beside the .npz, if present — so the overlay works even
    // for a standalone import with no Clip row.
    const videoKey = videoKeyForHandsKey(npzKey);
    const videoHead = await headR2Object(videoKey);
    const videoR2Key = videoHead.etag || videoHead.size != null ? videoKey : null;

    if (existing) {
      // Backfill links we now know but that weren't set before.
      const patch: { clipId?: string; videoR2Key?: string } = {};
      if (opts.clipId && !existing.clipId) patch.clipId = opts.clipId;
      if (videoR2Key && !existing.videoR2Key) patch.videoR2Key = videoR2Key;
      if (Object.keys(patch).length) {
        await prisma.handFile.update({ where: { id: existing.id }, data: patch });
      }
      return { ok: true, id: existing.id, alreadyExisted: true };
    }

    const bytes = await getObjectBytes(npzKey);
    const parsed = parseHandNpz(bytes);
    const viewerKey = npzKey.replace(/\.npz$/i, "") + ".viewer.bin";
    await putObjectBytes(viewerKey, packViewer(parsed));
    const id = await headR2Object(npzKey);
    const title = opts.title ?? (npzKey.split("/").pop() || npzKey).replace(/\.npz$/i, "");

    const created = await prisma.handFile.create({
      data: {
        title,
        npzR2Key: npzKey,
        viewerR2Key: viewerKey,
        clipId: opts.clipId ?? null,
        videoR2Key,
        sizeBytes: id.size ?? bytes.length,
        fps: parsed.fps,
        frameCount: parsed.frameCount,
        handCount: parsed.handCount,
        confirmedPct: parsed.confirmedPct,
        droppedFrames: parsed.droppedFrames,
        sourceEtag: id.etag,
        sourceVerifiedAt: new Date(),
      },
      select: { id: true },
    });
    return { ok: true, id: created.id, alreadyExisted: false };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// The pre-label / hands convention: the file that sits beside a clip's video,
// with the extension swapped. e.g. …/foo.mp4 -> …/foo.hands.npz
export function handsKeyForClipKey(clipR2Key: string): string {
  return clipR2Key.replace(/\.[^./]+$/, "") + ".hands.npz";
}

// The reverse: the video that should sit beside a hand file.
// …/foo.hands.npz -> …/foo.mp4   (…/foo.npz -> …/foo.mp4)
export function videoKeyForHandsKey(npzKey: string): string {
  if (/\.hands\.npz$/i.test(npzKey)) return npzKey.replace(/\.hands\.npz$/i, ".mp4");
  return npzKey.replace(/\.npz$/i, ".mp4");
}

// Candidate hand-file keys for a clip: beside the flat MP4, or in the proxy
// folder for session clips.
export function clipHandsKeyCandidates(clip: {
  r2Key?: string | null;
  proxyR2Key?: string | null;
}): string[] {
  const out: string[] = [];
  if (clip.r2Key) out.push(handsKeyForClipKey(clip.r2Key));
  if (clip.proxyR2Key) {
    const dir = clip.proxyR2Key.replace(/\/[^/]*$/, "");
    if (dir) out.push(`${dir}/hands.npz`);
  }
  return out;
}

// The first candidate that actually exists in R2, or null. HEAD never throws.
export async function resolveClipHandsKey(clip: {
  r2Key?: string | null;
  proxyR2Key?: string | null;
}): Promise<string | null> {
  for (const key of clipHandsKeyCandidates(clip)) {
    const id = await headR2Object(key);
    if (id.etag || id.size != null) return key;
  }
  return null;
}
