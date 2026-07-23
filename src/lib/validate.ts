// Submission QA validation — the guideline's §6 Final QA Checklist, as code.
// Pure + plain-shaped so it runs both client-side (live checklist) and server-side
// (submit guard). `errors` block submit (structural integrity); `warnings` are
// completeness nudges that surface but don't block.

export type VSub = {
  label: string;
  description: string;
  startFrame: number;
  endFrame: number;
};

export type VTask = {
  label: string;
  difficulty: string;
  venueL2: string;
  venueL3: string;
  job: string;
  qualityFlags: string[];
  startFrame: number;
  endFrame: number;
  subTasks: VSub[];
};

export type Issue = { code: string; message: string };
export type Validation = { errors: Issue[]; warnings: Issue[] };

// Overlap in frames between two spans (0 = none).
function overlap(a: VTask, b: VTask): number {
  return Math.min(a.endFrame, b.endFrame) - Math.max(a.startFrame, b.startFrame);
}

// Gap/overlap of sub-tasks tiling a task span, in frames.
function tiling(task: VTask): { gapFrames: number; overlapFrames: number } {
  const span = Math.max(0, task.endFrame - task.startFrame);
  if (span === 0) return { gapFrames: 0, overlapFrames: 0 };
  const segs = [...task.subTasks]
    .map((s) => [Math.max(s.startFrame, task.startFrame), Math.min(s.endFrame, task.endFrame)] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  let cursor = task.startFrame;
  let gapFrames = 0;
  let overlapFrames = 0;
  for (const [s, e] of segs) {
    if (s > cursor) gapFrames += s - cursor;
    if (s < cursor) overlapFrames += cursor - s;
    cursor = Math.max(cursor, e);
  }
  if (cursor < task.endFrame) gapFrames += task.endFrame - cursor;
  return { gapFrames, overlapFrames };
}

// Human name for a task in checklist copy: its label, or its frame range.
function label(t: VTask): string {
  return t.label ? `“${t.label}”` : `${t.startFrame}–${t.endFrame}`;
}

// Sub-task tiling is checked to the guideline's L2 boundary precision (±15
// frames), not frame-perfect — a gap/overlap this small is annotation noise, not
// an error. Bigger than this is a real gap/overlap and blocks submit.
const COVERAGE_TOLERANCE_FRAMES = 15;

// Guideline duration guidance (soft — "usually", exceptions allowed).
const L1_MIN_SEC = 30;
const L1_MAX_SEC = 15 * 60;
const L2_MIN_SEC = 1;
const L2_MAX_SEC = 5;

function secs(frames: number, fps: number): number {
  return fps > 0 ? frames / fps : 0;
}

// Row-level duration hints (null = within guideline range). Shared by the panels
// so inline badges and the QA checklist agree.
export function taskDurationHint(frames: number, fps: number): string | null {
  if (fps <= 0 || frames <= 0) return null;
  const d = secs(frames, fps);
  return d < L1_MIN_SEC || d > L1_MAX_SEC ? `${d.toFixed(1)}s · usually 30s–15min` : null;
}

export function subTaskDurationHint(frames: number, fps: number, label: string): string | null {
  if (fps <= 0 || frames <= 0 || label.trim() === "idle_wait") return null;
  const d = secs(frames, fps);
  return d < L2_MIN_SEC || d > L2_MAX_SEC ? `${d.toFixed(1)}s · usually 1–5s` : null;
}

export function validateSubmission(input: {
  tasks: VTask[];
  fps: number;
  reviewedQFrames: number; // sampled frames that have an explicit Q row
  totalQFrames: number; // sampled frames expected (frameCount / sampleEveryN)
}): Validation {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const { tasks, fps } = input;

  if (tasks.length === 0) {
    errors.push({ code: "no_tasks", message: "No tasks yet — find and label every long-horizon task." });
  }

  // L1 must not overlap (distinct spans with gaps between them).
  const sorted = [...tasks].sort((a, b) => a.startFrame - b.startFrame);
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const ov = overlap(sorted[i], sorted[j]);
      if (ov > 0)
        errors.push({
          code: "l1_overlap",
          message: `Tasks ${label(sorted[i])} and ${label(sorted[j])} overlap by ${ov}f.`,
        });
    }
  }

  for (const t of tasks) {
    const name = label(t);
    if (!t.label.trim())
      errors.push({ code: "task_label", message: `Task ${name} needs a label.` });
    if (t.endFrame <= t.startFrame)
      errors.push({ code: "task_span", message: `Task ${name} ends before it starts.` });
    else if (fps > 0) {
      const d = secs(t.endFrame - t.startFrame, fps);
      if (d < L1_MIN_SEC || d > L1_MAX_SEC)
        warnings.push({
          code: "task_duration",
          message: `Task ${name} runs ${d.toFixed(1)}s — tasks are usually 30s to 15min.`,
        });
    }

    const needsEnv = t.qualityFlags.includes("needs_env_review");
    if (!t.difficulty)
      warnings.push({ code: "task_difficulty", message: `Task ${name} needs a difficulty.` });
    if (!needsEnv && (!t.venueL2 || !t.venueL3 || !t.job))
      warnings.push({
        code: "task_taxonomy",
        message: `Task ${name} is missing its venue or job — fill them in, or flag it needs_env_review.`,
      });

    // Sub-tasks must fully tile the task, no gaps/overlaps.
    if (t.subTasks.length === 0) {
      warnings.push({ code: "no_subtasks", message: `Task ${name} has no sub-tasks yet.` });
    } else {
      const { gapFrames, overlapFrames } = tiling(t);
      const span = t.endFrame - t.startFrame;
      if (gapFrames > COVERAGE_TOLERANCE_FRAMES)
        errors.push({
          code: "subtask_gap",
          message: `Task ${name}: sub-tasks cover ${span - gapFrames}/${span}f — add sub-tasks for the remaining ${gapFrames}f (idle_wait covers pauses).`,
        });
      else if (gapFrames > 0)
        warnings.push({ code: "subtask_gap_small", message: `Task ${name} has ${gapFrames}f uncovered — within the ±${COVERAGE_TOLERANCE_FRAMES}f tolerance.` });
      if (overlapFrames > COVERAGE_TOLERANCE_FRAMES)
        errors.push({ code: "subtask_overlap", message: `Task ${name}: sub-tasks overlap by ${overlapFrames}f.` });
      else if (overlapFrames > 0)
        warnings.push({ code: "subtask_overlap_small", message: `Task ${name}: sub-tasks overlap by ${overlapFrames}f — within the ±${COVERAGE_TOLERANCE_FRAMES}f tolerance.` });
      for (const s of t.subTasks) {
        if (!s.label.trim())
          errors.push({ code: "subtask_label", message: `A sub-task in task ${name} needs a label.` });
        else {
          const tokens = s.label.trim().split("_").filter(Boolean).length;
          if (tokens < 2 || tokens > 5)
            warnings.push({
              code: "subtask_tokens",
              message: `Sub-task “${s.label}” should be 2–5 words joined by underscores.`,
            });
        }
        if (!s.description.trim())
          warnings.push({
            code: "subtask_desc",
            message: `Sub-task “${s.label || "unlabeled"}” in task ${name} needs a description.`,
          });
        if (fps > 0 && s.endFrame > s.startFrame) {
          const d = secs(s.endFrame - s.startFrame, fps);
          // idle_wait bridges pauses and is legitimately long — don't warn on it.
          if (s.label.trim() !== "idle_wait" && (d < L2_MIN_SEC || d > L2_MAX_SEC))
            warnings.push({
              code: "subtask_duration",
              message: `Sub-task “${s.label || "unlabeled"}” runs ${d.toFixed(1)}s — sub-tasks are usually 1–5s.`,
            });
        }
      }
    }
  }

  // Q frame quality: real_work must be judged on every sampled frame.
  if (input.totalQFrames > 0 && input.reviewedQFrames < input.totalQFrames) {
    warnings.push({
      code: "q_incomplete",
      message: `Frame quality reviewed on ${input.reviewedQFrames} of ${input.totalQFrames} sampled frames.`,
    });
  }

  return { errors, warnings };
}
