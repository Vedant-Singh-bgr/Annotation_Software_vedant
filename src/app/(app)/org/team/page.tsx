import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import NewMemberForm from "./NewMemberForm";
import MemberActions from "./MemberActions";

export default async function TeamPage() {
  const user = (await getSession())!;
  if (user.role !== "ORG_ADMIN") redirect("/dashboard");

  const members = await prisma.user.findMany({
    where: { organizationId: user.organizationId },
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { assignments: true } } },
  });

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <div>
        <h1 className="mb-5 font-serif text-2xl font-medium text-ink-900">Team</h1>
        <div className="grid gap-4">
          {members.map((m) => (
            <div
              key={m.id}
              className={`card flex items-center gap-4 p-5 ${m.active ? "" : "opacity-60"}`}
            >
              <div className="grid h-10 w-10 place-items-center rounded-full bg-ink-900/5 text-sm font-medium text-ink-700">
                {m.name.slice(0, 2).toUpperCase()}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 font-medium text-ink-900">
                  {m.name}
                  {!m.active && (
                    <span className="badge border-accent-red/25 bg-accent-red/5 text-accent-red">Deactivated</span>
                  )}
                </div>
                <div className="text-xs text-ink-400">{m.email}</div>
              </div>
              <div className="text-right">
                <span className="badge border-ink-900/10 bg-ink-900/[0.03] text-ink-700">
                  {m.role === "ORG_ADMIN" ? "Admin" : "Annotator"}
                </span>
                <div className="mt-1 text-xs text-ink-400">
                  {m._count.assignments} tasks
                </div>
              </div>
              <MemberActions userId={m.id} active={m.active} isSelf={m.id === user.id} />
            </div>
          ))}
        </div>
      </div>

      <NewMemberForm />
    </div>
  );
}
