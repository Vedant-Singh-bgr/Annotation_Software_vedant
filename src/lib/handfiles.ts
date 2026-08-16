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
      select: { id: true, clipId: true },
    });
    if (existing) {
      // Backfill the clip link if we now know it and it wasn't set before.
      if (opts.clipId && !existing.clipId) {
        await prisma.handFile.update({ where: { id: existing.id }, data: { clipId: opts.clipId } });
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
