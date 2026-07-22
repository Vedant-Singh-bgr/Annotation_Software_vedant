import { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth";
import { handle, badRequest } from "@/lib/api";
import { isR2Configured, listSessionManifests } from "@/lib/r2";

// List session manifests under an R2 prefix, for bulk-import selection.
export async function GET(req: NextRequest) {
  return handle(async () => {
    await requireRole("PLATFORM_ADMIN");
    if (!isR2Configured())
      badRequest("R2 is not configured; set R2_* env vars to browse sessions.");

    const url = new URL(req.url);
    const prefix = url.searchParams.get("prefix") ?? "";
    const token = url.searchParams.get("token") ?? undefined;

    const { sessions, nextToken } = await listSessionManifests({ prefix, token });
    return { sessions, nextToken };
  });
}
