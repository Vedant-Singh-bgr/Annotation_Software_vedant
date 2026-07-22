import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import TopNav from "@/components/TopNav";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSession();
  if (!user) redirect("/login");

  const org = user.organizationId
    ? await prisma.organization.findUnique({
        where: { id: user.organizationId },
        select: { name: true },
      })
    : null;

  // Count of work awaiting review, for the "Review" nav badge (role-scoped).
  const submittedCount =
    user.role === "ANNOTATOR"
      ? 0
      : await prisma.assignment.count({
          where: {
            status: "SUBMITTED",
            ...(user.role === "ORG_ADMIN"
              ? { clip: { batch: { project: { organizationId: user.organizationId! } } } }
              : {}),
          },
        });

  const links =
    user.role === "PLATFORM_ADMIN"
      ? [
          { href: "/dashboard", label: "Overview" },
          { href: "/admin/organizations", label: "Organizations" },
          { href: "/admin/projects", label: "Projects & Clips" },
          { href: "/review", label: "Review", badge: submittedCount },
          { href: "/admin/taxonomies", label: "Approved Lists" },
        ]
      : user.role === "ORG_ADMIN"
        ? [
            { href: "/dashboard", label: "Overview" },
            { href: "/org/projects", label: "Projects" },
            { href: "/review", label: "Review", badge: submittedCount },
            { href: "/org/team", label: "Team" },
          ]
        : [{ href: "/dashboard", label: "My Tasks" }];

  return (
    <div className="min-h-screen">
      <TopNav
        name={user.name}
        role={user.role}
        orgName={org?.name ?? null}
        links={links}
      />
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}
