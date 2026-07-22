import {
  S3Client,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// Cloudflare R2 is S3-compatible. Credentials never reach the browser — the
// server lists the bucket and mints short-lived presigned GET URLs for playback.

export function isR2Configured(): boolean {
  return Boolean(
    process.env.R2_ACCOUNT_ID &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      process.env.R2_BUCKET,
  );
}

let client: S3Client | null = null;

function r2Client(): S3Client {
  if (client) return client;
  const accountId = process.env.R2_ACCOUNT_ID!;
  client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });
  return client;
}

const VIDEO_EXT = /\.(mp4|mov|webm|mkv|avi|m4v)$/i;

export type R2Object = {
  key: string;
  size: number;
  lastModified: string | null;
  isVideo: boolean;
};

export type R2Listing = {
  prefixes: string[]; // "folders" under the current prefix
  objects: R2Object[];
  nextToken: string | null;
};

/** List one page of the bucket under a prefix, folder-style (delimiter "/"). */
export async function listR2Objects(opts: {
  prefix?: string;
  token?: string;
  maxKeys?: number;
}): Promise<R2Listing> {
  const cmd = new ListObjectsV2Command({
    Bucket: process.env.R2_BUCKET!,
    Prefix: opts.prefix || undefined,
    Delimiter: "/",
    ContinuationToken: opts.token || undefined,
    MaxKeys: opts.maxKeys ?? 200,
  });
  const res = await r2Client().send(cmd);

  const prefixes = (res.CommonPrefixes ?? [])
    .map((p) => p.Prefix ?? "")
    .filter(Boolean);

  const objects: R2Object[] = (res.Contents ?? [])
    .filter((o) => o.Key && !o.Key.endsWith("/")) // skip folder placeholders
    .map((o) => ({
      key: o.Key!,
      size: o.Size ?? 0,
      lastModified: o.LastModified ? o.LastModified.toISOString() : null,
      isVideo: VIDEO_EXT.test(o.Key!),
    }));

  return {
    prefixes,
    objects,
    nextToken: res.IsTruncated ? (res.NextContinuationToken ?? null) : null,
  };
}

export type R2SessionManifest = {
  key: string; // full .../sessions/<id>/manifest.json key
  sessionId: string;
  dataType: string | null;
  worker: string | null;
  size: number;
  lastModified: string | null;
};

/**
 * List session manifests under a prefix, recursively (no delimiter), by matching
 * keys ending in `/manifest.json`. The upload backend writes them at
 * `tenants/<t>/worksites/<ws>/workers/<wk>/<data_type>/sessions/<session_id>/manifest.json`.
 * Point `prefix` at a worksite/worker to avoid paging over content-addressed blobs.
 */
export async function listSessionManifests(opts: {
  prefix?: string;
  token?: string;
  maxKeys?: number;
}): Promise<{ sessions: R2SessionManifest[]; nextToken: string | null }> {
  const res = await r2Client().send(
    new ListObjectsV2Command({
      Bucket: process.env.R2_BUCKET!,
      Prefix: opts.prefix || undefined,
      ContinuationToken: opts.token || undefined,
      MaxKeys: opts.maxKeys ?? 1000,
    }),
  );

  const sessions: R2SessionManifest[] = (res.Contents ?? [])
    .filter((o) => o.Key && o.Key.endsWith("/manifest.json"))
    .map((o) => {
      const key = o.Key!;
      const m = key.match(/([^/]+)\/sessions\/([^/]+)\/manifest\.json$/);
      const w = key.match(/workers\/([^/]+)\//);
      return {
        key,
        sessionId: m?.[2] ?? key,
        dataType: m?.[1] ?? null,
        worker: w?.[1] ?? null,
        size: o.Size ?? 0,
        lastModified: o.LastModified ? o.LastModified.toISOString() : null,
      };
    });

  return {
    sessions,
    nextToken: res.IsTruncated ? (res.NextContinuationToken ?? null) : null,
  };
}

/** Fetch a small text object (e.g. manifest.json) from R2 by key. */
export async function getObjectText(key: string): Promise<string> {
  const res = await r2Client().send(
    new GetObjectCommand({ Bucket: process.env.R2_BUCKET!, Key: key }),
  );
  return await res.Body!.transformToString();
}

/** Write a JSON object to R2 at `key` (overwrites). Returns the key. */
export async function putObjectJson(key: string, value: unknown): Promise<string> {
  await r2Client().send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET!,
      Key: key,
      Body: JSON.stringify(value, null, 2),
      ContentType: "application/json",
    }),
  );
  return key;
}

/** Presigned GET URL for an object key in the configured R2 bucket. */
export async function presignVideoUrl(key: string): Promise<string> {
  const ttl = Number(process.env.R2_URL_TTL ?? "3600") || 3600;
  const cmd = new GetObjectCommand({
    Bucket: process.env.R2_BUCKET!,
    Key: key,
  });
  return getSignedUrl(r2Client(), cmd, { expiresIn: ttl });
}

/**
 * Resolve the streamable URL for a clip. Preference order:
 *   1. the transcoded MP4 proxy in R2 (proxyR2Key, once ready) — the normal path,
 *   2. a legacy single-object r2Key,
 *   3. a stored sourceUrl (demo / local proxy) so the platform runs before R2.
 * MCAP segment blobs are never streamed directly (not browser-playable).
 */
export async function resolveClipUrl(clip: {
  r2Key?: string | null;
  sourceUrl?: string | null;
  proxyR2Key?: string | null;
  proxyStatus?: string | null;
}): Promise<{ url: string; source: "r2" | "direct" } | null> {
  // Serve the proxy whenever a proxyR2Key exists (it's only set after a
  // successful transcode, so the object is in R2). This keeps playback working
  // during a RE-transcode: the old proxy streams until the new one overwrites
  // the same key — status may be "queued"/"transcoding" but the video still plays.
  if (isR2Configured() && clip.proxyR2Key) {
    return { url: await presignVideoUrl(clip.proxyR2Key), source: "r2" };
  }
  if (isR2Configured() && clip.r2Key) {
    return { url: await presignVideoUrl(clip.r2Key), source: "r2" };
  }
  if (clip.sourceUrl) {
    return { url: clip.sourceUrl, source: "direct" };
  }
  return null;
}
