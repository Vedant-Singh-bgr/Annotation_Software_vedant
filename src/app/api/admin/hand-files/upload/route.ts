import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { handle, badRequest } from "@/lib/api";
import { isR2Configured, putObjectBytes, headR2Object } from "@/lib/r2";
import { parseHandNpz, packViewer } from "@/lib/npz";

// Upload a hand-tracking .npz straight from the browser and persist it as a
// HandFile so it can be QC'd (approve/reject) — the alternative to importing
// from an R2 prefix. Same parse → pack → store → create pipeline, just fed by an
// uploaded file instead of an object already in the bucket.
export const runtime = "nodejs";

const HANDS_UPLOAD_PREFIX = process.env.HANDS_R2_PREFIX
  ? `${process.env.HANDS_R2_PREFIX.replace(/\/$/, "")}/uploads/`
  : "hands/uploads/";

function safeName(name: string): string {
  return (name.split(/[\\/]/).pop() || "hands.npz").replace(/[^A-Za-z0-9._-]/g, "_");
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    await requireRole("PLATFORM_ADMIN");
    if (!isR2Configured()) badRequest("R2 is not configured — a persisted file needs somewhere to live.");

    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) badRequest("No .npz file was uploaded.");
    if (!/\.npz$/i.test((file as File).name)) badRequest("Please upload a .npz file.");

    const bytes = new Uint8Array(await (file as File).arrayBuffer());
    // Parse first — a bad file should fail before anything is written to R2.
    const parsed = parseHandNpz(bytes);

    const name = safeName((file as File).name);
    const npzKey = `${HANDS_UPLOAD_PREFIX}${name}`;

    // Idempotent by key: re-uploading the same filename returns the existing row
    // rather than overwriting it.
    const existing = await prisma.handFile.findUnique({
      where: { npzR2Key: npzKey },
      select: { id: true },
    });
    if (existing) return { id: existing.id, alreadyExisted: true };

    const viewerKey = npzKey.replace(/\.npz$/i, "") + ".viewer.bin";
    await putObjectBytes(npzKey, bytes, "application/octet-stream");
    await putObjectBytes(viewerKey, packViewer(parsed), "application/octet-stream");
    const id = await headR2Object(npzKey);

    const created = await prisma.handFile.create({
      data: {
        title: name.replace(/\.npz$/i, ""),
        npzR2Key: npzKey,
        viewerR2Key: viewerKey,
        sizeBytes: bytes.length,
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
    return { id: created.id };
  });
}
