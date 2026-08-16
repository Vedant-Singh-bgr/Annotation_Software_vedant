import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { handle, badRequest } from "@/lib/api";
import { isR2Configured, listR2Objects } from "@/lib/r2";
import { captureHandFile } from "@/lib/handfiles";

// Hand-tracking .npz files are imported from the R2 bucket. Listing is
// folder-style (delimiter "/") so the admin can browse subfolders instead of
// guessing a prefix. Each import parses the .npz once, stores a compact viewer
// payload beside it, and records the QC signals on a HandFile row.
const NPZ_RE = /\.npz$/i;

// GET ?prefix= — browse one folder level: its subfolders + the .npz files
// directly under it (marking which are already imported). Empty prefix = root.
export async function GET(req: NextRequest) {
  return handle(async () => {
    await requireRole("PLATFORM_ADMIN");
    const prefix = new URL(req.url).searchParams.get("prefix") || "";
    if (!isR2Configured()) return { configured: false, prefix, prefixes: [], files: [] };

    const listing = await listR2Objects({ prefix, maxKeys: 1000 });
    const npz = listing.objects.filter((o) => NPZ_RE.test(o.key));
    const existing = await prisma.handFile.findMany({
      where: { npzR2Key: { in: npz.map((o) => o.key) } },
      select: { npzR2Key: true },
    });
    const imported = new Set(existing.map((e) => e.npzR2Key));
    return {
      configured: true,
      prefix,
      // Subfolders to drill into.
      prefixes: listing.prefixes,
      // .npz directly at this level.
      files: npz.map((o) => ({ key: o.key, size: o.size, imported: imported.has(o.key) })),
      truncated: listing.nextToken != null,
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

    const batchId = body?.batchId ? String(body.batchId) : null;
    if (batchId) {
      const batch = await prisma.handBatch.findUnique({ where: { id: batchId }, select: { id: true } });
      if (!batch) badRequest("Batch not found.");
    }

    const results: { key: string; ok: boolean; error?: string }[] = [];
    for (const key of keys) {
      const r = await captureHandFile({ npzKey: key, batchId });
      if (r.ok && r.alreadyExisted) results.push({ key, ok: false, error: "already imported" });
      else if (r.ok) results.push({ key, ok: true });
      else results.push({ key, ok: false, error: r.error });
    }
    const imported = results.filter((r) => r.ok).length;
    return { imported, skipped: results.length - imported, results };
  });
}
