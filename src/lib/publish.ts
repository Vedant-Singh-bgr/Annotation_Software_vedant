import { prisma } from "@/lib/db";
import { isR2Configured, putObjectJson } from "@/lib/r2";
import { buildAssignmentExport } from "@/lib/export";

// Publishing = writing an assignment's export JSON to R2 *next to the MP4 proxy
// it describes, so the video and its labels are one deliverable:
//
//   tenants/<t>/proxies/<sessionId>/ego.mp4
//   tenants/<t>/proxies/<sessionId>/annotations/<assignmentId>.json
//
// One key per assignment (not per clip) because a clip can be annotated by
// several annotators — their outputs must not overwrite each other. Re-publishing
// the same assignment overwrites its own key, so the object is always current.

/**
 * Derive the annotation key from the clip's proxy key, so the JSON lands in the
 * same folder as the actual MP4 even if the proxy naming convention changes.
 * Falls back to the `transcode.ts` layout when no proxy exists yet.
 */
export function annotationKeyFor(
  clip: { proxyR2Key?: string | null; tenantId?: string | null; sessionId?: string | null; id: string },
  assignmentId: string,
): string {
  if (clip.proxyR2Key) {
    const dir = clip.proxyR2Key.replace(/\/[^/]*$/, ""); // strip "/ego.mp4"
    return `${dir}/annotations/${assignmentId}.json`;
  }
  const sid = clip.sessionId ?? clip.id;
  return clip.tenantId
    ? `tenants/${clip.tenantId}/proxies/${sid}/annotations/${assignmentId}.json`
    : `proxies/${sid}/annotations/${assignmentId}.json`;
}

export type PublishResult = { key: string; bytes: number };

/**
 * Build the export for an assignment and upload it to R2. Records the key on the
 * assignment (or the failure reason) so the UI can show where it landed.
 * `assignment` must already be authorized and include clip.batch.project.
 */
export async function publishAssignmentExport(
  assignment: Parameters<typeof buildAssignmentExport>[0] & { id: string },
): Promise<PublishResult> {
  if (!isR2Configured()) {
    throw new Error("R2 is not configured, so the export cannot be published to the cloud.");
  }

  const key = annotationKeyFor(assignment.clip, assignment.id);
  const payload = await buildAssignmentExport(assignment);
  const body = { ...payload, exportR2Key: key };

  try {
    await putObjectJson(key, body);
  } catch (err) {
    await prisma.assignment.update({
      where: { id: assignment.id },
      data: { exportError: (err as Error).message },
    });
    throw err;
  }

  await prisma.assignment.update({
    where: { id: assignment.id },
    data: {
      exportR2Key: key,
      exportedAt: new Date(),
      exportError: null,
      // Queue the burned-in overlay render. Publishing is the moment the labels
      // become final, so it is exactly when the watchable artefact should be
      // built. Only APPROVED work reaches here, so nothing unreviewed renders.
      // Re-publishing re-queues, which is what you want after a correction.
      overlayStatus: "queued",
      overlayError: null,
    },
  });

  return { key, bytes: JSON.stringify(body).length };
}

// ── Batch delivery ──────────────────────────────────────────────────────────

const MANIFEST_VERSION = 1;
const PUBLISH_CONCURRENCY = 8;

/** R2 key for a batch's delivery manifest. */
export function batchManifestKey(batchId: string): string {
  return `exports/batches/${batchId}/manifest.json`;
}

/** Run `worker` over `items` with at most `limit` in flight; preserves order. */
async function mapPool<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function run(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

export type BatchPublishEntry = {
  assignmentId: string;
  clipId: string;
  clipTitle: string;
  sessionId: string | null;
  annotator: string;
  proxyR2Key: string | null;
  // The original uploaded object, so a consumer can pair labels with the
  // untouched video straight from the manifest — without it, the manifest only
  // points at the downscaled proxy.
  sourceR2Key: string | null;
  exportR2Key: string | null;
  exportedAt: string | null;
  error: string | null;
};

export type BatchPublishResult = {
  batchId: string;
  manifestKey: string;
  published: number;
  failed: number;
  eligible: number;
  entries: BatchPublishEntry[];
};

/**
 * Publish every APPROVED assignment in a batch to R2, then write a manifest.json
 * listing the pairs (clip proxy + export JSON). Approval is the delivery gate, so
 * only approved work ships. Per-assignment failures are isolated and recorded;
 * the manifest still lists them with their error so the run is diagnosable.
 * `batchId` must already be authorized by the caller.
 */
export async function publishBatchExports(batchId: string): Promise<BatchPublishResult> {
  if (!isR2Configured()) {
    throw new Error("R2 is not configured, so the batch cannot be published to the cloud.");
  }

  const batch = await prisma.batch.findUnique({
    where: { id: batchId },
    include: { project: { select: { name: true } } },
  });
  if (!batch) throw new Error("Batch not found.");

  // Only APPROVED assignments are deliverable.
  const assignments = await prisma.assignment.findMany({
    where: { status: "APPROVED", clip: { batchId } },
    include: {
      annotator: { select: { name: true } },
      clip: { include: { batch: { include: { project: true } } } },
    },
    orderBy: { updatedAt: "asc" },
  });

  const entries = await mapPool(assignments, PUBLISH_CONCURRENCY, async (a) => {
    const base: BatchPublishEntry = {
      assignmentId: a.id,
      clipId: a.clip.id,
      clipTitle: a.clip.title,
      sessionId: a.clip.sessionId,
      annotator: a.annotator.name,
      proxyR2Key: a.clip.proxyR2Key ?? null,
      sourceR2Key: a.clip.r2Key ?? null,
      exportR2Key: null,
      exportedAt: null,
      error: null,
    };
    try {
      const { key } = await publishAssignmentExport(a);
      return { ...base, exportR2Key: key, exportedAt: new Date().toISOString() };
    } catch (err) {
      return { ...base, error: (err as Error).message };
    }
  });

  const published = entries.filter((e) => e.error === null).length;
  const failed = entries.length - published;
  const manifestKey = batchManifestKey(batchId);

  const manifest = {
    manifestVersion: MANIFEST_VERSION,
    generatedAt: new Date().toISOString(),
    batch: { id: batch.id, name: batch.name, project: batch.project.name },
    counts: { eligible: assignments.length, published, failed },
    entries,
  };

  // Write the manifest even on partial failure — it is the record of the run.
  await putObjectJson(manifestKey, manifest);
  await prisma.batch.update({
    where: { id: batchId },
    data: { manifestR2Key: manifestKey, publishedAt: new Date() },
  });

  return { batchId, manifestKey, published, failed, eligible: assignments.length, entries };
}
