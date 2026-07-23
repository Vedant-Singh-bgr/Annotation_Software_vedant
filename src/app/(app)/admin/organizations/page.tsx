import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import NewOrgForm from "./NewOrgForm";
import OrgActions from "./OrgActions";

export default async function OrganizationsPage() {
  const user = (await getSession())!;
  if (user.role !== "PLATFORM_ADMIN") redirect("/dashboard");

  const orgs = await prisma.organization.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { users: true, projects: true } },
    },
  });

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <div>
        <h1 className="mb-4 text-xl font-semibold text-white">Organizations</h1>
        {orgs.length === 0 ? (
          <div className="card p-8 text-center text-sm text-slate-500">
            No organizations yet. Create the first annotation company →
          </div>
        ) : (
          <div className="grid gap-3">
            {orgs.map((o) => (
              <div
                key={o.id}
                className={`card flex items-center gap-4 p-4 ${o.active ? "" : "opacity-60"}`}
              >
                <div className="grid h-10 w-10 place-items-center rounded-full bg-ink-700 text-sm font-semibold text-slate-200">
                  {o.name.slice(0, 2).toUpperCase()}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 font-medium text-slate-100">
                    {o.name}
                    {!o.active && (
                      <span className="badge bg-red-950/50 text-red-300">Archived</span>
                    )}
                  </div>
                  <div className="text-xs text-slate-500">/{o.slug}</div>
                </div>
                <div className="text-right text-xs text-slate-400">
                  <div>{o._count.users} users</div>
                  <div>{o._count.projects} projects</div>
                </div>
                <OrgActions orgId={o.id} active={o.active} />
              </div>
            ))}
          </div>
        )}
      </div>

      <NewOrgForm />
    </div>
  );
}
