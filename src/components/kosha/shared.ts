export type SubTask = {
  id: string;
  taskId: string;
  startFrame: number;
  endFrame: number;
  label: string;
  description: string;
  objectLeft: string;
  objectRight: string;
  confidence: number | null;
  notes: string;
};

export type Task = {
  id: string;
  startFrame: number;
  endFrame: number;
  label: string;
  difficulty: string;
  venueL2: string;
  venueL3: string;
  job: string;
  confidence: number | null;
  qualityFlags: string[];
  notes: string;
  subTasks: SubTask[];
};

export type FrameQuality = {
  frameIndex: number;
  realWork: boolean;
  repetitive: boolean;
  occluded: boolean;
  smudge: boolean;
  glare: boolean;
  blur: boolean;
  notes: string;
};

export type Taxonomies = {
  VENUE_L2: string[];
  VENUE_L3: string[];
  JOB: string[];
};

export async function api(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error ?? "Request failed") as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return data;
}

// Overlapping L1 task pairs. The guideline treats long-horizon tasks as distinct
// spans with unlabeled gaps between them — they must not overlap in time.
export function taskOverlaps(
  tasks: Task[],
): { a: Task; b: Task; frames: number }[] {
  const sorted = [...tasks].sort((x, y) => x.startFrame - y.startFrame);
  const out: { a: Task; b: Task; frames: number }[] = [];
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i];
      const b = sorted[j];
      const ov = Math.min(a.endFrame, b.endFrame) - Math.max(a.startFrame, b.startFrame);
      if (ov > 0) out.push({ a, b, frames: ov });
    }
  }
  return out;
}

// Coverage of a task span [start,end) by its sub-tasks: gaps + overlaps in frames.
export function coverage(task: Task): {
  covered: number;
  span: number;
  pct: number;
  gaps: [number, number][];
  overlaps: number;
} {
  const span = Math.max(0, task.endFrame - task.startFrame);
  const segs = [...task.subTasks]
    .map((s) => [s.startFrame, s.endFrame] as [number, number])
    .sort((a, b) => a[0] - b[0]);

  const gaps: [number, number][] = [];
  let overlaps = 0;
  let cursor = task.startFrame;
  let covered = 0;

  for (const [s, e] of segs) {
    const cs = Math.max(s, task.startFrame);
    const ce = Math.min(e, task.endFrame);
    if (cs > cursor) gaps.push([cursor, cs]); // gap before this seg
    if (cs < cursor) overlaps += cursor - cs; // overlap with prior coverage
    covered += Math.max(0, ce - Math.max(cs, cursor));
    cursor = Math.max(cursor, ce);
  }
  if (cursor < task.endFrame) gaps.push([cursor, task.endFrame]);

  const pct = span > 0 ? Math.round((covered / span) * 100) : 0;
  return { covered, span, pct, gaps, overlaps };
}
