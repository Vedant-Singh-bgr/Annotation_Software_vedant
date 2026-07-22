import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import AssignBoard from "./AssignBoard";

export default async function OrgProjectsPage() {
  const user = (await getSession())!;
  if (user.role !== "ORG_ADMIN") redirect("/dashboard");
  const orgId = user.organizationId!;

  const [projects, annotators] = await Promise.all([
    prisma.project.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: "desc" },
      include: {
        batches: {
          orderBy: { createdAt: "desc" },
          include: {
            clips: {
              orderBy: { createdAt: "desc" },
              include: {
                assignments: {
                  include: { annotator: { select: { id: true, name: true } } },
                },
              },
            },
          },
        },
      },
    }),
    prisma.user.findMany({
      where: { organizationId: orgId, role: "ANNOTATOR" },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  const data = projects.map((p) => ({
    id: p.id,
    name: p.name,
    batches: p.batches.map((b) => ({
      id: b.id,
      name: b.name,
      clips: b.clips.map((c) => ({
        id: c.id,
        title: c.title,
        assignments: c.assignments.map((a) => ({
          id: a.id,
          status: a.status,
          annotator: a.annotator,
        })),
      })),
    })),
  }));

  return <AssignBoard projects={data} annotators={annotators} />;
}
