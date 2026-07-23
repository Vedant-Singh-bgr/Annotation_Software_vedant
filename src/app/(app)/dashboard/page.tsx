import Link from "next/link";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import StatusBadge from "@/components/StatusBadge";

export default async function DashboardPage() {
  const user = (await getSession())!; // layout guarantees auth

  if (user.role === "ANNOTATOR") return <AnnotatorDashboard userId={user.id} />;
  if (user.role === "ORG_ADMIN")
    return <OrgAdminDashboard orgId={user.organizationId!} />;
  return <PlatformDashboard />;
}

async function AnnotatorDashboard({ userId }: { userId: string }) {
  const assignments = await prisma.assignment.findMany({
    where: { annotatorId: userId },
    orderBy: { updatedAt: "desc" },
    include: {
      clip: { include: { batch: { include: { project: true } } } },
      _count: { select: { tasks: true, frameQuality: true } },
    },
  });

  return (
    <div>
      <h1 className="mb-1 font-serif text-2xl font-medium text-ink-900">My tasks</h1>
      <p className="mb-6 text-sm text-ink-500">
        {assignments.length} clip{assignments.length === 1 ? "" : "s"} assigned to you
      </p>

      {assignments.length === 0 ? (
        <EmptyState message="No clips assigned yet. Your org admin will assign work here." />
      ) : (
        <div className="grid gap-4">
          {assignments.map((a) => (
            <Link
              key={a.id}
              href={`/annotate/${a.id}`}
              className="card flex items-center gap-4 p-5 transition-colors duration-150 hover:border-ink-900/20 hover:bg-ink-900/[0.03]"
            >
              <div className="grid h-10 w-16 place-items-center rounded-lg bg-paper-50 text-ink-400">
                ▶
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-ink-900">
                  {a.clip.title}
                </div>
                <div className="text-xs text-ink-400">
                  {a.clip.batch.project.name} · {a.clip.batch.name} ·{" "}
                  {a._count.tasks} task{a._count.tasks === 1 ? "" : "s"}
                </div>
              </div>
              <StatusBadge status={a.status} />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

async function OrgAdminDashboard({ orgId }: { orgId: string }) {
  const clipWhere = { batch: { project: { organizationId: orgId } } };
  const [projectCount, clipCount, memberCount, byStatus] = await Promise.all([
    prisma.project.count({ where: { organizationId: orgId } }),
    prisma.clip.count({ where: clipWhere }),
    prisma.user.count({ where: { organizationId: orgId, role: "ANNOTATOR" } }),
    prisma.assignment.groupBy({
      by: ["status"],
      where: { clip: clipWhere },
      _count: true,
    }),
  ]);

  const statusMap = Object.fromEntries(byStatus.map((s) => [s.status, s._count]));

  return (
    <div>
      <h1 className="mb-6 font-serif text-2xl font-medium text-ink-900">Overview</h1>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Projects" value={projectCount} />
        <Stat label="Clips" value={clipCount} />
        <Stat label="Annotators" value={memberCount} />
        <Stat label="Submitted" value={statusMap["SUBMITTED"] ?? 0} />
      </div>

      <h2 className="mb-3 mt-8 text-sm font-medium text-ink-900">Work status</h2>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        {["ASSIGNED", "IN_PROGRESS", "SUBMITTED", "APPROVED", "REJECTED"].map(
          (s) => (
            <div key={s} className="card p-5">
              <div className="mb-2">
                <StatusBadge status={s} />
              </div>
              <div className="font-serif text-3xl text-ink-900">
                {statusMap[s] ?? 0}
              </div>
            </div>
          ),
        )}
      </div>

      <div className="mt-8">
        <Link href="/org/projects" className="btn-primary">
          Manage assignments →
        </Link>
      </div>
    </div>
  );
}

async function PlatformDashboard() {
  const [orgCount, projectCount, clipCount, taskCount] = await Promise.all([
    prisma.organization.count(),
    prisma.project.count(),
    prisma.clip.count(),
    prisma.task.count(),
  ]);

  return (
    <div>
      <h1 className="mb-6 font-serif text-2xl font-medium text-ink-900">Platform overview</h1>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Organizations" value={orgCount} />
        <Stat label="Projects" value={projectCount} />
        <Stat label="Clips" value={clipCount} />
        <Stat label="L1 tasks labeled" value={taskCount} />
      </div>
      <div className="mt-8 flex gap-3">
        <Link href="/admin/projects" className="btn-primary">
          Projects & clips →
        </Link>
        <Link href="/admin/taxonomies" className="btn-ghost">
          Approved lists
        </Link>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="card p-5">
      <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-500">{label}</div>
      <div className="mt-1.5 font-serif text-3xl text-ink-900">{value}</div>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="card grid place-items-center py-16 text-center text-sm text-ink-400">
      {message}
    </div>
  );
}
