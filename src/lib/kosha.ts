// Kosha Labs v4 guideline domain constants + helpers.
// Everything temporal is a FRAME INDEX (integer, first frame = 0).

export const DEFAULT_FPS = 30;
export const DEFAULT_SAMPLE_EVERY_N = 45; // Q cadence

export const DIFFICULTIES = ["easy", "medium", "hard"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

// Task-level (L1) quality flags — multi-select.
export const TASK_QUALITY_FLAGS = [
  "needs_review",
  "needs_env_review",
  "idle_or_repetitive",
  "hands_occluded",
  "staged_or_low_value",
  "needs_taxonomy_review",
] as const;
export type TaskQualityFlag = (typeof TASK_QUALITY_FLAGS)[number];

// Frame-quality (Q) boolean flags, in display order. real_work is the primary.
export const FRAME_QUALITY_FLAGS = [
  { key: "realWork", label: "real_work", primary: true },
  { key: "repetitive", label: "repetitive", primary: false },
  { key: "occluded", label: "occluded", primary: false },
  { key: "smudge", label: "smudge", primary: false },
  { key: "glare", label: "glare", primary: false },
  { key: "blur", label: "blur", primary: false },
] as const;

// Approved-list taxonomy types (Appendix A).
export const TAXONOMY_TYPES = ["VENUE_L2", "VENUE_L3", "JOB"] as const;
export type TaxonomyType = (typeof TAXONOMY_TYPES)[number];

export const TAXONOMY_LABELS: Record<TaxonomyType, string> = {
  VENUE_L2: "Venue (L2) — facility",
  VENUE_L3: "Venue (L3) — room/zone",
  JOB: "Job title",
};

// ── frame <-> time ──────────────────────────────────────────────────────────
export function frameToTime(frame: number, fps: number): number {
  return frame / (fps || DEFAULT_FPS);
}

/** Sampled frame indices for Q: 0, N, 2N, … up to frameCount (exclusive). */
export function sampledFrames(frameCount: number, everyN: number): number[] {
  const out: number[] = [];
  const step = Math.max(1, everyN || DEFAULT_SAMPLE_EVERY_N);
  for (let f = 0; f < frameCount; f += step) out.push(f);
  return out;
}

export function parseFlags(json: string): string[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}
