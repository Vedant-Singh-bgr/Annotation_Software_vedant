import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isR2Configured } from "@/lib/r2";
import BatchManager from "./BatchManager";

type Props = { params: Promise<{ id: string }> };

export default async function ProjectDetailPage({ params }: Props) {
  const user = (await getSession())!;
  if (user.role !== "PLATFORM_ADMIN") redirect("/dashboard");
  const { id } = await params;

  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      organization: { select: { name: true } },
      batches: {
        orderBy: { createdAt: "desc" },
        include: {
          clips: {
            orderBy: { createdAt: "desc" },
            include: {
              _count: { select: { assignments: true, segments: true } },
              assignments: {
                orderBy: { updatedAt: "desc" },
                include: { annotator: { select: { name: true } } },
              },
            },
          },
        },
      },
    },
  });
  if (!project) notFound();

  const data = {
    id: project.id,
    name: project.name,
    org: project.organization.name,
    batches: project.batches.map((b) => ({
      id: b.id,
      name: b.name,
      r2Prefix: b.r2Prefix,
      sampleEveryN: b.sampleEveryN,
      defaultFps: b.defaultFps,
      manifestR2Key: b.manifestR2Key,
      publishedAt: b.publishedAt ? b.publishedAt.toISOString() : null,
      approvedCount: b.clips.reduce(
        (n, c) => n + c.assignments.filter((a) => a.status === "APPROVED").length,
        0,
      ),
      clips: b.clips.map((c) => ({
        id: c.id,
        title: c.title,
        r2Key: c.r2Key,
        sourceUrl: c.sourceUrl,
        sizeBytes: c.sizeBytes,
        fps: c.fps,
        assignmentCount: c._count.assignments,
        sessionId: c.sessionId,
        dataType: c.dataType,
        proxyStatus: c.proxyStatus,
        proxyError: c.proxyError,
        frameCount: c.frameCount,
        segmentCount: c._count.segments,
        assignments: c.assignments.map((a) => ({
          id: a.id,
          status: a.status,
          annotator: a.annotator.name,
        })),
      })),
    })),
  };

  return (
    <div>
      <div className="mb-4 flex items-center gap-2 text-sm text-ink-500">
        <Link
          href="/admin/projects"
          className="transition-colors duration-200 hover:text-ink-900 hover:underline hover:decoration-ink-900/20 hover:underline-offset-2"
        >
          ← Projects
        </Link>
        <span>/</span>
        <span className="text-ink-800">{project.name}</span>
        <span className="text-ink-400">· {project.organization.name}</span>
      </div>

      <BatchManager project={data} r2Configured={isR2Configured()} />
    </div>
  );
}
