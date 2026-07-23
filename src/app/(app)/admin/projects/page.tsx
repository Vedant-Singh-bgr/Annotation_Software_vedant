import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import NewProjectForm from "./NewProjectForm";

export default async function AdminProjectsPage() {
  const user = (await getSession())!;
  if (user.role !== "PLATFORM_ADMIN") redirect("/dashboard");

  const [orgs, projects] = await Promise.all([
    prisma.organization.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.project.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        organization: { select: { name: true } },
        batches: {
          select: { id: true, _count: { select: { clips: true } } },
        },
      },
    }),
  ]);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <div>
        <h1 className="mb-4 font-serif text-2xl font-medium text-ink-900">Projects & Clips</h1>
        {projects.length === 0 ? (
          <div className="card p-8 text-center text-sm text-ink-400">
            No projects yet. Create one, then add a batch and import clips from R2 →
          </div>
        ) : (
          <div className="grid gap-3">
            {projects.map((p) => {
              const clipCount = p.batches.reduce(
                (n, b) => n + b._count.clips,
                0,
              );
              return (
                <Link
                  key={p.id}
                  href={`/admin/projects/${p.id}`}
                  className="card flex items-center gap-4 p-5 transition-colors duration-150 hover:border-ink-900/20"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-ink-900">{p.name}</div>
                    <div className="text-xs text-ink-400">
                      {p.organization.name}
                      {p.description ? ` · ${p.description}` : ""}
                    </div>
                  </div>
                  <div className="text-right text-xs text-ink-500">
                    <div>{p.batches.length} batches</div>
                    <div>{clipCount} clips</div>
                  </div>
                  <span className="text-ink-300">→</span>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      <NewProjectForm orgs={orgs} />
    </div>
  );
}
