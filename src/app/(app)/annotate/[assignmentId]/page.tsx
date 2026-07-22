import Link from "next/link";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { resolveClipUrl } from "@/lib/r2";
import { getAuthorizedAssignment, canEditAnnotations } from "@/lib/access";
import { parseFlags, TAXONOMY_TYPES } from "@/lib/kosha";
import KoshaWorkspace from "@/components/kosha/KoshaWorkspace";
import type { Task } from "@/components/kosha/shared";
import PublishButton from "@/app/(app)/review/PublishButton";

type Props = { params: Promise<{ assignmentId: string }> };

export default async function AnnotatePage({ params }: Props) {
  const user = (await getSession())!;
  const { assignmentId } = await params;

  let assignment;
  try {
    assignment = await getAuthorizedAssignment(user, assignmentId);
  } catch {
    notFound();
  }

  const clip = assignment.clip;
  const batch = clip.batch;

  const [dbTasks, dbQuality, taxItems, resolved] = await Promise.all([
    prisma.task.findMany({
      where: { assignmentId },
      orderBy: { startFrame: "asc" },
      include: { subTasks: { orderBy: { startFrame: "asc" } } },
    }),
    prisma.frameQuality.findMany({
      where: { assignmentId },
      orderBy: { frameIndex: "asc" },
    }),
    prisma.taxonomyItem.findMany({
      where: { projectId: null, active: true },
      orderBy: { sortOrder: "asc" },
    }),
    resolveClipUrl(clip),
  ]);

  const tasks: Task[] = dbTasks.map((t) => ({
    id: t.id,
    startFrame: t.startFrame,
    endFrame: t.endFrame,
    label: t.label,
    difficulty: t.difficulty,
    venueL2: t.venueL2,
    venueL3: t.venueL3,
    job: t.job,
    confidence: t.confidence,
    qualityFlags: parseFlags(t.qualityFlags),
    notes: t.notes,
    subTasks: t.subTasks.map((s) => ({
      id: s.id,
      taskId: s.taskId,
      startFrame: s.startFrame,
      endFrame: s.endFrame,
      label: s.label,
      description: s.description,
      objectLeft: s.objectLeft,
      objectRight: s.objectRight,
      confidence: s.confidence,
      notes: s.notes,
    })),
  }));

  const taxonomies = Object.fromEntries(
    TAXONOMY_TYPES.map((type) => [
      type,
      taxItems.filter((i) => i.type === type).map((i) => i.value),
    ]),
  ) as { VENUE_L2: string[]; VENUE_L3: string[]; JOB: string[] };

  const editable = canEditAnnotations(user, assignment);
  const canReview = user.role !== "ANNOTATOR";

  return (
    <div>
      <div className="mb-4 flex items-center gap-2 text-sm text-slate-400">
        <Link href="/dashboard" className="hover:text-slate-200">
          ← Back
        </Link>
        <span>/</span>
        <span>{batch.project.name}</span>
        <span className="text-slate-600">· {batch.name}</span>
        {canReview && (
          <div className="ml-auto">
            <PublishButton
              assignmentId={assignmentId}
              exportR2Key={assignment.exportR2Key}
              exportedAt={assignment.exportedAt ? assignment.exportedAt.toISOString() : null}
              exportError={assignment.exportError}
            />
          </div>
        )}
      </div>

      {!resolved ? (
        <div className="card p-8 text-center text-sm text-slate-400">
          This clip has no playable source. Set an R2 key (with R2 creds) or a
          fallback source URL.
        </div>
      ) : (
        <KoshaWorkspace
          assignmentId={assignmentId}
          clipTitle={clip.title}
          videoUrl={resolved.url}
          videoSource={resolved.source}
          fps={clip.fps}
          frameCount={clip.frameCount}
          sampleEveryN={batch.sampleEveryN}
          status={assignment.status}
          reviewNote={assignment.reviewNote}
          editable={editable}
          canReview={canReview}
          taxonomies={taxonomies}
          initialTasks={tasks}
          initialQuality={dbQuality.map((q) => ({
            frameIndex: q.frameIndex,
            realWork: q.realWork,
            repetitive: q.repetitive,
            occluded: q.occluded,
            smudge: q.smudge,
            glare: q.glare,
            blur: q.blur,
            notes: q.notes,
          }))}
        />
      )}
    </div>
  );
}
