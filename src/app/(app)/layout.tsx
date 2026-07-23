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

  // Count of work awaiting review, for the "Review" nav badge. Scoped by role
  // with an explicit default — as a ternary chain the else-branch was
  // platform-wide, so a QC user would have seen a count spanning every
  // organisation.
  const reviewScope: Record<string, unknown> | null =
    user.role === "PLATFORM_ADMIN"
      ? {}
      : user.role === "ORG_ADMIN"
        ? { clip: { batch: { project: { organizationId: user.organizationId! } } } }
        : user.role === "QC"
          ? { reviewerId: user.id }
          : null; // ANNOTATOR and anything unrecognised: no review badge
  const submittedCount = reviewScope
    ? await prisma.assignment.count({ where: { status: "SUBMITTED", ...reviewScope } })
    : 0;

  const links =
    user.role === "PLATFORM_ADMIN"
      ? [
          { href: "/dashboard", label: "Overview" },
          { href: "/admin/organizations", label: "Organizations" },
          { href: "/admin/projects", label: "Projects & Clips" },
          { href: "/review", label: "Review", badge: submittedCount },
          { href: "/admin/overlays", label: "Overlay Clips" },
          { href: "/admin/taxonomies", label: "Approved Lists" },
        ]
      : user.role === "ORG_ADMIN"
        ? [
            { href: "/dashboard", label: "Overview" },
            { href: "/org/projects", label: "Projects" },
            { href: "/review", label: "Review", badge: submittedCount },
            { href: "/org/team", label: "Team" },
          ]
        : user.role === "QC"
          ? [
              { href: "/dashboard", label: "Overview" },
              { href: "/review", label: "Review", badge: submittedCount },
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
      <main className="mx-auto max-w-7xl px-6 py-10">{children}</main>
    </div>
  );
}
