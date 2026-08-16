import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { handle, badRequest } from "@/lib/api";
import {
  isR2Configured,
  listR2Objects,
  getObjectBytes,
  putObjectBytes,
  headR2Object,
} from "@/lib/r2";
import { parseHandNpz, packViewer } from "@/lib/npz";

// Hand-tracking .npz files are imported from an R2 prefix (default `hands/`),
// exactly like clip folders. Each import parses the .npz once, stores a compact
// viewer payload beside it, and records the QC signals on a HandFile row.
const HANDS_PREFIX = process.env.HANDS_R2_PREFIX || "hands/";
const NPZ_RE = /\.npz$/i;

async function listNpz(prefix: string) {
  const out: { key: string; size: number }[] = [];
  let token: string | undefined;
  do {
    const page = await listR2Objects({ prefix, token, maxKeys: 1000 });
    for (const o of page.objects) if (NPZ_RE.test(o.key)) out.push({ key: o.key, size: o.size });
    token = page.nextToken ?? undefined;
  } while (token);
  return out;
}

// GET ?prefix= — list .npz under the hands prefix, marking which are imported.
export async function GET(req: NextRequest) {
  return handle(async () => {
    await requireRole("PLATFORM_ADMIN");
    const prefix = new URL(req.url).searchParams.get("prefix") || HANDS_PREFIX;
    if (!isR2Configured()) return { configured: false, prefix, files: [] };
    const objs = await listNpz(prefix);
    const existing = await prisma.handFile.findMany({
      where: { npzR2Key: { in: objs.map((o) => o.key) } },
      select: { npzR2Key: true },
    });
    const imported = new Set(existing.map((e) => e.npzR2Key));
    return {
      configured: true,
      prefix,
      files: objs.map((o) => ({ ...o, imported: imported.has(o.key) })),
    };
  });
}

// POST { keys: string[] } — import the selected .npz: fetch, parse, pack the
// viewer payload, capture identity, create the HandFile. Idempotent per key.
export async function POST(req: NextRequest) {
  return handle(async () => {
    await requireRole("PLATFORM_ADMIN");
    const body = await req.json().catch(() => null);
    const keys: string[] = Array.isArray(body?.keys)
      ? body.keys.map(String).filter(Boolean)
      : [];
    if (keys.length === 0) badRequest("Select at least one .npz to import.");
    if (!isR2Configured()) badRequest("R2 is not configured.");

    const existing = await prisma.handFile.findMany({
      where: { npzR2Key: { in: keys } },
      select: { npzR2Key: true },
    });
    const skip = new Set(existing.map((e) => e.npzR2Key));

    const results: { key: string; ok: boolean; error?: string }[] = [];
    for (const key of keys) {
      if (skip.has(key)) {
        results.push({ key, ok: false, error: "already imported" });
        continue;
      }
      try {
        const bytes = await getObjectBytes(key);
        const parsed = parseHandNpz(bytes);
        const viewerKey = key.replace(/\.npz$/i, "") + ".viewer.bin";
        await putObjectBytes(viewerKey, packViewer(parsed));
        const id = await headR2Object(key);
        const title = (key.split("/").pop() || key).replace(/\.npz$/i, "");
        await prisma.handFile.create({
          data: {
            title,
            npzR2Key: key,
            viewerR2Key: viewerKey,
            sizeBytes: id.size ?? bytes.length,
            fps: parsed.fps,
            frameCount: parsed.frameCount,
            handCount: parsed.handCount,
            confirmedPct: parsed.confirmedPct,
            droppedFrames: parsed.droppedFrames,
            sourceEtag: id.etag,
            sourceVerifiedAt: new Date(),
          },
        });
        results.push({ key, ok: true });
      } catch (e) {
        results.push({ key, ok: false, error: (e as Error).message });
      }
    }
    const imported = results.filter((r) => r.ok).length;
    return { imported, skipped: results.length - imported, results };
  });
}
