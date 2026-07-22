import { prisma } from "@/lib/db";
import { parseFlags } from "@/lib/kosha";

// Builds the structured export payload (guideline Required Output Fields, L1/L2/Q
// + session/segment provenance) for one assignment. The JSON is always generated
// on demand from the DB — it is never stored, so there are no files to keep in
// sync. `assignment` must already be authorized and include clip.batch.project.
export async function buildAssignmentExport(assignment: {
  id: string;
  status: string;
  clip: {
    id: string;
    title: string;
    fps: number;
    frameCount: number | null;
    sessionId: string | null;
    sessionHash: string | null;
    dataType: string | null;
    workerId: string | null;
    worksiteId: string | null;
    tenantId: string | null;
    proxyStatus: string;
    proxyR2Key?: string | null;
    batch: { name: string; sampleEveryN: number; project: { name: string } };
  };
}) {
  const clip = assignment.clip;
  const videoId = clip.title;

  const [tasks, frameQuality, segments] = await Promise.all([
    prisma.task.findMany({
      where: { assignmentId: assignment.id },
      orderBy: { startFrame: "asc" },
      include: { subTasks: { orderBy: { startFrame: "asc" } } },
    }),
    prisma.frameQuality.findMany({
      where: { assignmentId: assignment.id },
      orderBy: { frameIndex: "asc" },
    }),
    prisma.clipSegment.findMany({
      where: { clipId: clip.id },
      orderBy: { orderIndex: "asc" },
    }),
  ]);

  const locate = (frame: number) => {
    const seg = segments.find(
      (s) =>
        s.startFrame != null &&
        s.endFrame != null &&
        frame >= s.startFrame &&
        frame < s.endFrame,
    );
    if (!seg) return null;
    return {
      segment: seg.logicalPath,
      sha256: seg.sha256,
      frame_in_segment: frame - (seg.startFrame ?? 0),
    };
  };

  const L1_tasks = tasks.map((t) => ({
    video_id: videoId,
    task_id: t.id,
    task_start_frame: t.startFrame,
    task_end_frame: t.endFrame,
    task_label: t.label,
    difficulty: t.difficulty,
    venue_L2: t.venueL2,
    venue_L3: t.venueL3,
    job: t.job,
    task_confidence: t.confidence,
    quality_flags: parseFlags(t.qualityFlags),
    notes: t.notes,
    source_start: locate(t.startFrame),
    source_end: locate(t.endFrame),
  }));

  const L2_subtasks = tasks.flatMap((t) =>
    t.subTasks.map((s) => ({
      video_id: videoId,
      task_id: t.id,
      action_start_frame: s.startFrame,
      action_end_frame: s.endFrame,
      action_label: s.label,
      description: s.description,
      object_left: s.objectLeft,
      object_right: s.objectRight,
      confidence: s.confidence,
      notes: s.notes,
      source_start: locate(s.startFrame),
      source_end: locate(s.endFrame),
    })),
  );

  const Q_frame_quality = frameQuality.map((f) => ({
    video_id: videoId,
    frame_index: f.frameIndex,
    real_work: f.realWork,
    repetitive: f.repetitive,
    occluded: f.occluded,
    smudge: f.smudge,
    glare: f.glare,
    blur: f.blur,
    notes: f.notes,
  }));

  return {
    exportedAt: new Date().toISOString(),
    project: clip.batch.project.name,
    batch: clip.batch.name,
    clip: {
      id: clip.id,
      title: clip.title,
      fps: clip.fps,
      frameCount: clip.frameCount,
      sampleEveryN: clip.batch.sampleEveryN,
    },
    session: {
      session_id: clip.sessionId,
      session_hash: clip.sessionHash,
      data_type: clip.dataType,
      worker_id: clip.workerId,
      worksite_id: clip.worksiteId,
      tenant_id: clip.tenantId,
      proxy_status: clip.proxyStatus,
      // The exact MP4 these labels describe — the JSON is stored beside it in R2.
      proxy_r2_key: clip.proxyR2Key ?? null,
      segments: segments.map((s) => ({
        order: s.orderIndex,
        logical_path: s.logicalPath,
        sha256: s.sha256,
        r2_blob_key: s.r2BlobKey,
        size_bytes: s.sizeBytes,
        start_frame: s.startFrame,
        end_frame: s.endFrame,
      })),
    },
    assignmentId: assignment.id,
    status: assignment.status,
    L1_tasks,
    L2_subtasks,
    Q_frame_quality,
  };
}
