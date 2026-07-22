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
      <h1 className="mb-1 text-xl font-semibold text-white">My tasks</h1>
      <p className="mb-6 text-sm text-slate-400">
        {assignments.length} clip{assignments.length === 1 ? "" : "s"} assigned to you
      </p>

      {assignments.length === 0 ? (
        <EmptyState message="No clips assigned yet. Your org admin will assign work here." />
      ) : (
        <div className="grid gap-3">
          {assignments.map((a) => (
            <Link
              key={a.id}
              href={`/annotate/${a.id}`}
              className="card flex items-center gap-4 p-4 hover:border-brand-500"
            >
              <div className="grid h-10 w-16 place-items-center rounded bg-ink-800 text-slate-500">
                ▶
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-slate-100">
                  {a.clip.title}
                </div>
                <div className="text-xs text-slate-500">
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
      <h1 className="mb-6 text-xl font-semibold text-white">Overview</h1>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Projects" value={projectCount} />
        <Stat label="Clips" value={clipCount} />
        <Stat label="Annotators" value={memberCount} />
        <Stat label="Submitted" value={statusMap["SUBMITTED"] ?? 0} />
      </div>

      <h2 className="mb-3 mt-8 text-sm font-medium text-slate-300">Work status</h2>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        {["ASSIGNED", "IN_PROGRESS", "SUBMITTED", "APPROVED", "REJECTED"].map(
          (s) => (
            <div key={s} className="card p-4">
              <div className="mb-2">
                <StatusBadge status={s} />
              </div>
              <div className="text-2xl font-semibold text-white">
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
      <h1 className="mb-6 text-xl font-semibold text-white">Platform overview</h1>
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
    <div className="card p-4">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-white">{value}</div>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="card grid place-items-center p-12 text-center text-sm text-slate-500">
      {message}
    </div>
  );
}
