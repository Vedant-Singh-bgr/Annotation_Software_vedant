import { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth";
import { handle } from "@/lib/api";
import { isR2Configured, listR2Objects } from "@/lib/r2";

// Browse the R2 bucket folder-style. Platform admin only.
export async function GET(req: NextRequest) {
  return handle(async () => {
    await requireRole("PLATFORM_ADMIN");

    if (!isR2Configured()) {
      return {
        configured: false,
        prefixes: [],
        objects: [],
        nextToken: null,
      };
    }

    const url = new URL(req.url);
    const prefix = url.searchParams.get("prefix") ?? "";
    const token = url.searchParams.get("token") ?? "";

    const listing = await listR2Objects({ prefix, token });
    return { configured: true, prefix, ...listing };
  });
}
