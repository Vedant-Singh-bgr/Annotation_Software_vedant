import { NextRequest, NextResponse } from "next/server";
import { requireUser, AuthError } from "@/lib/auth";
import { handle, forbidden } from "@/lib/api";
import { getAuthorizedAssignment } from "@/lib/access";
import { buildAssignmentExport } from "@/lib/export";
import { publishAssignmentExport } from "@/lib/publish";

type Ctx = { params: Promise<{ id: string }> };

// Downloadable structured export (guideline Required Output Fields, L1/L2/Q).
// Generated on demand from the DB — never stored.
export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const assignment = await getAuthorizedAssignment(user, id);
    const payload = await buildAssignmentExport(assignment);

    const filename = `kosha-${assignment.clip.title.replace(/[^a-z0-9]+/gi, "_")}.json`;
    return new NextResponse(JSON.stringify(payload, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    const status = err instanceof AuthError ? err.status : 500;
    return NextResponse.json({ error: (err as Error).message }, { status });
  }
}

// Publish (or re-publish) the export to R2, beside the clip's MP4 proxy.
// Approval does this automatically; this is the manual retry / re-cut path for
// reviewers after a fix. Annotators cannot publish.
export async function POST(_req: NextRequest, { params }: Ctx) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await params;
    const assignment = await getAuthorizedAssignment(user, id);
    if (user.role === "ANNOTATOR") forbidden("Only reviewers can publish an export.");

    const { key, bytes } = await publishAssignmentExport(assignment);
    return { published: { key, bytes } };
  });
}
