import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { handle, forbidden } from "@/lib/api";

// Job-claim endpoint for the standalone transcode worker.
//
// The worker used to read SQLite directly; on managed Postgres that no longer
// works and coupling a separate process to the DB schema is fragile. Instead the
// worker polls THIS endpoint (shared-secret auth, same TRANSCODE_SECRET it uses
// to report results). We atomically claim the next queued clip here and hand back
// exactly the manifest fields the worker needs — so the worker stays completely
// DB-agnostic and needs no database credentials of its own.
function authorize(req: NextRequest): void {
  const secret = process.env.TRANSCODE_SECRET;
  const header = req.headers.get("x-transcode-secret");
  if (!secret) forbidden("TRANSCODE_SECRET is not configured.");
  if (header !== secret) forbidden("Invalid worker secret.");
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    authorize(req);

    // Atomic claim: find the oldest queued clip, then flip it to transcoding
    // only if it is still queued (updateMany count guards against a race with
    // another worker instance).
    const candidate = await prisma.clip.findFirst({
      where: { proxyStatus: "queued" },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (!candidate) return { job: null };

    const claimed = await prisma.clip.updateMany({
      where: { id: candidate.id, proxyStatus: "queued" },
      data: { proxyStatus: "transcoding", proxyError: null },
    });
    if (claimed.count === 0) return { job: null }; // lost the race; try next poll

    const clip = await prisma.clip.findUnique({
      where: { id: candidate.id },
      include: { segments: { orderBy: { orderIndex: "asc" } } },
    });
    if (!clip) return { job: null };

    return {
      job: {
        clipId: clip.id,
        sessionId: clip.sessionId,
        sessionHash: clip.sessionHash,
        tenantId: clip.tenantId,
        workerId: clip.workerId,
        dataType: clip.dataType,
        segments: clip.segments.map((s) => ({
          logical_path: s.logicalPath,
          checksum_sha256: s.sha256,
          r2_object_key: s.r2BlobKey,
          size_bytes: s.sizeBytes,
          content_type: s.contentType,
        })),
      },
    };
  });
}
