import { prisma } from "@/lib/db";
import { getObjectText, headR2Object, isR2Configured } from "@/lib/r2";
import { validateSubmission, VTask } from "@/lib/validate";

// Pre-labels: an admin-supplied annotation file, sitting in R2 next to a clip,
// that seeds an annotator's task/sub-task/frame-quality rows the moment the clip
// is assigned. The annotator then EDITS those rows instead of starting blank.
//
// The file format is the SAME schema the platform exports (see src/lib/export.ts)
// with one change: tasks and sub-tasks are linked by a caller-chosen `task_ref`
// string rather than the DB-minted `task_id`, since a hand-authored file has no
// ids yet. On seed we mint real ids and rewire the links. So an exported file,
// lightly edited, feeds straight back in.

export const PRELABEL_SCHEMA = "kosha-annotations-v1";

// Mirrors AnnotationsPanel: a taxonomy value not on the approved list is a
// "custom" value that must be vetted, flagged with this so QC sees it. Seeding a
// pre-label with off-list venue/job values raises it exactly as typing one would.
const TAXONOMY_REVIEW_FLAG = "needs_taxonomy_review";

type ApprovedTaxonomy = { VENUE_L2: Set<string>; VENUE_L3: Set<string>; JOB: Set<string> };

// The approved, global taxonomy (projectId null + active) — the same set the
// annotate page loads to decide what counts as on-list.
async function loadApprovedTaxonomy(): Promise<ApprovedTaxonomy> {
  const items = await prisma.taxonomyItem.findMany({
    where: { projectId: null, active: true },
    select: { type: true, value: true },
  });
  const pick = (type: string) =>
    new Set(items.filter((i) => i.type === type).map((i) => i.value));
  return { VENUE_L2: pick("VENUE_L2"), VENUE_L3: pick("VENUE_L3"), JOB: pick("JOB") };
}

// Add needs_taxonomy_review to a task's flags iff any taxonomy field is off-list.
function withTaxonomyFlag(flagsJson: string, t: ParsedTask, tax: ApprovedTaxonomy): string {
  let flags: string[] = [];
  try {
    const a = JSON.parse(flagsJson);
    if (Array.isArray(a)) flags = a.map(String);
  } catch {
    /* keep [] */
  }
  const off = (v: string, set: Set<string>) => !!v && !set.has(v);
  const anyCustom =
    off(t.job, tax.JOB) || off(t.venueL2, tax.VENUE_L2) || off(t.venueL3, tax.VENUE_L3);
  const has = flags.includes(TAXONOMY_REVIEW_FLAG);
  if (anyCustom && !has) flags = [...flags, TAXONOMY_REVIEW_FLAG];
  return JSON.stringify(flags);
}

export type SeedResult = {
  seeded: boolean;
  source?: string; // the R2 key the pre-labels came from
  tasks?: number;
  subTasks?: number;
  qframes?: number;
  reason?: string; // why nothing was seeded (missing file, invalid, already has work…)
};

// --- coercion helpers (a hand-authored file is untrusted input) -------------
function num(v: unknown, fallback = 0): number {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : fallback;
}
function int(v: unknown, fallback = 0): number {
  return Math.round(num(v, fallback));
}
function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}
function bool(v: unknown, fallback = false): boolean {
  return typeof v === "boolean" ? v : fallback;
}
function optNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = num(v, NaN);
  return Number.isFinite(n) ? n : null;
}

type ParsedSub = {
  orderIndex: number;
  startFrame: number;
  endFrame: number;
  label: string;
  description: string;
  objectLeft: string;
  objectRight: string;
  confidence: number | null;
  notes: string;
};
type ParsedTask = {
  orderIndex: number;
  startFrame: number;
  endFrame: number;
  label: string;
  difficulty: string;
  venueL2: string;
  venueL3: string;
  job: string;
  confidence: number | null;
  qualityFlags: string; // JSON array string, as stored
  notes: string;
  subTasks: ParsedSub[];
};
type ParsedQ = {
  frameIndex: number;
  realWork: boolean;
  repetitive: boolean;
  occluded: boolean;
  smudge: boolean;
  glare: boolean;
  blur: boolean;
  notes: string;
};
type Parsed = { tasks: ParsedTask[]; qframes: ParsedQ[] };

// Map the pre-label JSON into row-shaped structures, grouping L2 sub-tasks under
// their L1 parent by `task_ref`. Throws on a shape that isn't a pre-label file.
export function parsePrelabels(raw: unknown): Parsed {
  if (!raw || typeof raw !== "object") throw new Error("not a JSON object");
  const doc = raw as Record<string, unknown>;
  const L1 = Array.isArray(doc.L1_tasks) ? doc.L1_tasks : [];
  const L2 = Array.isArray(doc.L2_subtasks) ? doc.L2_subtasks : [];
  const Q = Array.isArray(doc.Q_frame_quality) ? doc.Q_frame_quality : [];
  if (L1.length === 0 && Q.length === 0)
    throw new Error("no L1_tasks or Q_frame_quality — is this a pre-label file?");

  // Index sub-tasks by their parent ref (fall back to a single-task file that
  // omits task_ref: attach orphans to the sole task).
  const byRef = new Map<string, ParsedSub[]>();
  const orphans: ParsedSub[] = [];
  for (let i = 0; i < L2.length; i++) {
    const s = L2[i] as Record<string, unknown>;
    const sub: ParsedSub = {
      orderIndex: i,
      startFrame: int(s.action_start_frame),
      endFrame: int(s.action_end_frame),
      label: str(s.action_label),
      description: str(s.description),
      objectLeft: str(s.object_left),
      objectRight: str(s.object_right),
      confidence: optNum(s.confidence),
      notes: str(s.notes),
    };
    const ref = str(s.task_ref);
    if (ref) {
      const arr = byRef.get(ref) ?? [];
      arr.push(sub);
      byRef.set(ref, arr);
    } else {
      orphans.push(sub);
    }
  }

  const tasks: ParsedTask[] = L1.map((t, i) => {
    const o = t as Record<string, unknown>;
    const ref = str(o.task_ref);
    const subs = (ref ? byRef.get(ref) : undefined) ?? (L1.length === 1 ? orphans : []);
    let flags = "[]";
    if (Array.isArray(o.quality_flags)) flags = JSON.stringify(o.quality_flags.map(str));
    return {
      orderIndex: i,
      startFrame: int(o.task_start_frame),
      endFrame: int(o.task_end_frame),
      label: str(o.task_label),
      difficulty: str(o.difficulty),
      venueL2: str(o.venue_L2),
      venueL3: str(o.venue_L3),
      job: str(o.job),
      confidence: optNum(o.task_confidence),
      qualityFlags: flags,
      notes: str(o.notes),
      subTasks: [...subs].sort((a, b) => a.startFrame - b.startFrame),
    };
  });

  const qframes: ParsedQ[] = Q.map((q) => {
    const o = q as Record<string, unknown>;
    return {
      frameIndex: int(o.frame_index),
      realWork: bool(o.real_work, true),
      repetitive: bool(o.repetitive),
      occluded: bool(o.occluded),
      smudge: bool(o.smudge),
      glare: bool(o.glare),
      blur: bool(o.blur),
      notes: str(o.notes),
    };
  });

  return { tasks, qframes };
}

// Structural check, reusing the exact submit-time validator so a seeded file
// starts in a state the annotator could themselves submit. Returns blocking
// error messages (empty = OK to seed). `no_tasks` is ignored: a Q-only pre-label
// is legitimate.
export function prelabelErrors(parsed: Parsed, fps: number): string[] {
  if (parsed.tasks.length === 0) return [];
  const vtasks: VTask[] = parsed.tasks.map((t) => ({
    label: t.label,
    difficulty: t.difficulty,
    venueL2: t.venueL2,
    venueL3: t.venueL3,
    job: t.job,
    qualityFlags: (() => {
      try {
        const a = JSON.parse(t.qualityFlags);
        return Array.isArray(a) ? a.map(String) : [];
      } catch {
        return [];
      }
    })(),
    startFrame: t.startFrame,
    endFrame: t.endFrame,
    subTasks: t.subTasks.map((s) => ({
      label: s.label,
      description: s.description,
      startFrame: s.startFrame,
      endFrame: s.endFrame,
    })),
  }));
  const { errors } = validateSubmission({
    tasks: vtasks,
    fps,
    reviewedQFrames: 0,
    totalQFrames: 0,
  });
  return errors.filter((e) => e.code !== "no_tasks").map((e) => e.message);
}

// Candidate R2 keys for a clip's pre-label file, most-specific first:
//  - flat MP4 clip: the object's key with the extension swapped for
//    `.prelabels.json` (e.g. clips/foo.mp4 -> clips/foo.prelabels.json)
//  - session clip: `prelabels.json` in the proxy folder, beside the exports
export function prelabelKeyCandidates(clip: {
  r2Key?: string | null;
  proxyR2Key?: string | null;
}): string[] {
  const out: string[] = [];
  if (clip.r2Key) out.push(clip.r2Key.replace(/\.[^./]+$/, "") + ".prelabels.json");
  if (clip.proxyR2Key) {
    const dir = clip.proxyR2Key.replace(/\/[^/]*$/, "");
    if (dir) out.push(`${dir}/prelabels.json`);
  }
  return out;
}

async function resolvePrelabelKey(clip: {
  r2Key?: string | null;
  proxyR2Key?: string | null;
}): Promise<string | null> {
  for (const key of prelabelKeyCandidates(clip)) {
    const id = await headR2Object(key); // never throws; null fields = missing
    if (id.etag || id.size != null) return key;
  }
  return null;
}

// Seed a freshly-created assignment from its clip's pre-label file, if one
// exists in R2. Non-fatal by contract: any failure (no file, unreadable,
// invalid, R2 down) returns { seeded:false, reason } and the assignment is left
// blank rather than the handoff being blocked. Idempotent — skips if the
// assignment already has tasks.
export async function maybeSeedPrelabels(params: {
  assignmentId: string;
  annotatorId: string;
  clip: { r2Key?: string | null; proxyR2Key?: string | null; fps: number };
}): Promise<SeedResult> {
  const { assignmentId, annotatorId, clip } = params;
  try {
    if (!isR2Configured()) return { seeded: false, reason: "R2 not configured" };

    const existing = await prisma.task.count({ where: { assignmentId } });
    if (existing > 0) return { seeded: false, reason: "assignment already has tasks" };

    const key = await resolvePrelabelKey(clip);
    if (!key) return { seeded: false, reason: "no pre-label file for this clip" };

    let raw: unknown;
    try {
      raw = JSON.parse(await getObjectText(key));
    } catch {
      return { seeded: false, source: key, reason: "pre-label file is not valid JSON" };
    }

    let parsed: Parsed;
    try {
      parsed = parsePrelabels(raw);
    } catch (e) {
      return { seeded: false, source: key, reason: (e as Error).message };
    }

    const errs = prelabelErrors(parsed, clip.fps);
    if (errs.length > 0)
      return { seeded: false, source: key, reason: `invalid pre-labels: ${errs.slice(0, 3).join("; ")}` };

    // So off-list pre-labeled venue/job values are flagged for QC just like a
    // hand-typed custom value would be.
    const tax = await loadApprovedTaxonomy();

    let subTotal = 0;
    await prisma.$transaction(async (tx) => {
      for (const t of parsed.tasks) {
        subTotal += t.subTasks.length;
        await tx.task.create({
          data: {
            assignmentId,
            createdById: annotatorId,
            orderIndex: t.orderIndex,
            startFrame: t.startFrame,
            endFrame: t.endFrame,
            label: t.label,
            difficulty: t.difficulty,
            venueL2: t.venueL2,
            venueL3: t.venueL3,
            job: t.job,
            confidence: t.confidence,
            qualityFlags: withTaxonomyFlag(t.qualityFlags, t, tax),
            notes: t.notes,
            subTasks: {
              create: t.subTasks.map((s) => ({
                createdById: annotatorId,
                orderIndex: s.orderIndex,
                startFrame: s.startFrame,
                endFrame: s.endFrame,
                label: s.label,
                description: s.description,
                objectLeft: s.objectLeft,
                objectRight: s.objectRight,
                confidence: s.confidence,
                notes: s.notes,
              })),
            },
          },
        });
      }
      if (parsed.qframes.length > 0) {
        await tx.frameQuality.createMany({
          data: parsed.qframes.map((q) => ({
            assignmentId,
            createdById: annotatorId,
            frameIndex: q.frameIndex,
            realWork: q.realWork,
            repetitive: q.repetitive,
            occluded: q.occluded,
            smudge: q.smudge,
            glare: q.glare,
            blur: q.blur,
            notes: q.notes,
          })),
        });
      }
    });

    return {
      seeded: true,
      source: key,
      tasks: parsed.tasks.length,
      subTasks: subTotal,
      qframes: parsed.qframes.length,
    };
  } catch (e) {
    // Never let seeding break assignment creation.
    return { seeded: false, reason: (e as Error).message };
  }
}
