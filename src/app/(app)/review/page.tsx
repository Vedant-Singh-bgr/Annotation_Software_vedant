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
      <h1 className="mb-1 font-serif text-2xl font-medium text-ink-900">Review queue</h1>
      <p className="mb-5 text-sm text-ink-500">
        {status === "SUBMITTED"
          ? "Annotations submitted and awaiting your review."
          : `Assignments with status ${status.toLowerCase()}.`}
      </p>

      <div className="mb-5 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => {
          const n = f === "ALL" ? totalAll : (counts[f] ?? 0);
          const active = f === status;
          return (
            <Link
              key={f}
              href={`/review?status=${f}`}
              className={`rounded-full px-3 py-1 text-xs transition-colors duration-150 ${
                active
                  ? "border border-ink-900/15 bg-ink-900/[0.04] text-ink-900"
                  : "text-ink-600 hover:bg-ink-900/5"
              }`}
            >
              {f.toLowerCase()} ({n})
            </Link>
          );
        })}
      </div>

      {assignments.length === 0 ? (
        <div className="card grid place-items-center py-16 text-center text-sm text-ink-400">
          {status === "SUBMITTED"
            ? "Nothing awaiting review right now."
            : `No ${status.toLowerCase()} assignments.`}
        </div>
      ) : (
        <div className="grid gap-2">
          {assignments.map((a) => (
            <div
              key={a.id}
              className="card flex items-center gap-4 p-4 transition-colors duration-150 hover:border-ink-900/20 hover:bg-ink-900/[0.03]"
            >
              <span className="text-ink-400">{a.clip.sessionId ? "🎬" : "▶"}</span>
              <Link href={`/annotate/${a.id}`} className="min-w-0 flex-1">
                <div className="truncate font-medium text-ink-900">{a.clip.title}</div>
                <div className="truncate text-xs text-ink-400">
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
                className="link shrink-0 text-xs"
                title="Replay with labels overlaid — streams from R2, no local files"
              >
                Overlay ↗
              </a>
              <Link
                href={`/annotate/${a.id}`}
                className="shrink-0 text-xs text-ink-500 transition-colors duration-150 hover:text-ink-900 hover:underline hover:decoration-ink-900/20 hover:underline-offset-2"
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
