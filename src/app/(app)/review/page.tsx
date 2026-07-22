import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import StatusBadge from "@/components/StatusBadge";
import PublishButton from "./PublishButton";

// Cross-project review queue. Platform admin sees every org; org admin sees only
// their own. Defaults to SUBMITTED (work awaiting review).
const FILTERS = ["SUBMITTED", "REJECTED", "APPROVED", "ALL"] as const;

type Props = { searchParams: Promise<{ status?: string }> };

export default async function ReviewQueuePage({ searchParams }: Props) {
  const user = (await getSession())!;
  if (user.role === "ANNOTATOR") redirect("/dashboard");

  const raw = (await searchParams).status?.toUpperCase();
  const status = (FILTERS as readonly string[]).includes(raw ?? "") ? raw! : "SUBMITTED";

  const orgScope =
    user.role === "ORG_ADMIN"
      ? { clip: { batch: { project: { organizationId: user.organizationId! } } } }
      : {};
  const where = {
    ...(status === "ALL" ? {} : { status }),
    ...orgScope,
  };

  // Counts for the filter chips (respecting org scope).
  const grouped = await prisma.assignment.groupBy({
    by: ["status"],
    where: orgScope,
    _count: true,
  });
  const counts = Object.fromEntries(grouped.map((g) => [g.status, g._count]));
  const totalAll = grouped.reduce((n, g) => n + g._count, 0);

  const assignments = await prisma.assignment.findMany({
    where,
    orderBy: [{ submittedAt: "desc" }, { updatedAt: "desc" }],
    take: 200,
    include: {
      annotator: { select: { name: true } },
      clip: {
        include: {
          batch: { include: { project: { select: { name: true, organizationId: true } } } },
          _count: { select: { assignments: true } },
        },
      },
    },
  });

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-white">Review queue</h1>
      <p className="mb-4 text-sm text-slate-400">
        {status === "SUBMITTED"
          ? "Annotations submitted and awaiting your review."
          : `Assignments with status ${status.toLowerCase()}.`}
      </p>

      <div className="mb-4 flex flex-wrap gap-1">
        {FILTERS.map((f) => {
          const n = f === "ALL" ? totalAll : (counts[f] ?? 0);
          const active = f === status;
          return (
            <Link
              key={f}
              href={`/review?status=${f}`}
              className={`rounded-full border px-3 py-1 text-xs ${
                active
                  ? "border-brand-500 bg-brand-600/20 text-white"
                  : "border-ink-700 text-slate-300 hover:bg-ink-800"
              }`}
            >
              {f.toLowerCase()} ({n})
            </Link>
          );
        })}
      </div>

      {assignments.length === 0 ? (
        <div className="card grid place-items-center p-12 text-center text-sm text-slate-500">
          {status === "SUBMITTED"
            ? "Nothing awaiting review right now."
            : `No ${status.toLowerCase()} assignments.`}
        </div>
      ) : (
        <div className="grid gap-2">
          {assignments.map((a) => (
            <div
              key={a.id}
              className="card flex items-center gap-4 p-3 hover:border-brand-500"
            >
              <span className="text-slate-500">{a.clip.sessionId ? "🎬" : "▶"}</span>
              <Link href={`/annotate/${a.id}`} className="min-w-0 flex-1">
                <div className="truncate font-medium text-slate-100">{a.clip.title}</div>
                <div className="truncate text-xs text-slate-500">
                  {a.clip.batch.project.name} · {a.clip.batch.name} · {a.annotator.name}
                  {a.submittedAt
                    ? ` · submitted ${new Date(a.submittedAt).toLocaleDateString()}`
                    : ""}
                </div>
              </Link>
              <StatusBadge status={a.status} />
              <PublishButton
                assignmentId={a.id}
                exportR2Key={a.exportR2Key}
                exportedAt={a.exportedAt ? a.exportedAt.toISOString() : null}
                exportError={a.exportError}
              />
              <a
                href={`/overlay.html?assignment=${a.id}`}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 text-xs text-brand-400 hover:underline"
                title="Replay with labels overlaid — streams from R2, no local files"
              >
                Overlay ↗
              </a>
              <Link
                href={`/annotate/${a.id}`}
                className="shrink-0 text-xs text-slate-400 hover:underline"
              >
                {a.status === "SUBMITTED" ? "Review →" : "Edit"}
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
