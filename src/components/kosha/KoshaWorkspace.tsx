"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { frameToTime, sampledFrames, parseFlags } from "@/lib/kosha";
import { validateSubmission } from "@/lib/validate";
import { Task, SubTask, FrameQuality, Taxonomies, api, coverage } from "./shared";
import TasksPanel from "./TasksPanel";
import SubTasksPanel from "./SubTasksPanel";
import QualityPanel from "./QualityPanel";
import VideoOverlay from "./VideoOverlay";

type Props = {
  assignmentId: string;
  clipTitle: string;
  videoUrl: string;
  videoSource: "r2" | "direct";
  fps: number;
  frameCount: number | null;
  sampleEveryN: number;
  status: string;
  reviewNote: string;
  editable: boolean;
  canReview: boolean;
  taxonomies: Taxonomies;
  initialTasks: Task[];
  initialQuality: FrameQuality[];
};

type Tab = "tasks" | "subtasks" | "quality";

export default function KoshaWorkspace(props: Props) {
  const { assignmentId, fps, editable, canReview } = props;
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);

  const [tasks, setTasks] = useState<Task[]>(props.initialTasks);
  const [quality, setQuality] = useState<Record<number, FrameQuality>>(
    Object.fromEntries(props.initialQuality.map((q) => [q.frameIndex, q])),
  );
  const [status, setStatus] = useState(props.status);
  const [reviewNote, setReviewNote] = useState(props.reviewNote);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(
    props.initialTasks[0]?.id ?? null,
  );
  const [selectedSubId, setSelectedSubId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("tasks");

  // Pin the presigned video URL to its first value. It's valid for R2_URL_TTL
  // (~1h); freezing it means re-renders/refreshes never swap the <video> src and
  // snap playback back to frame 0.
  const [videoUrl] = useState(props.videoUrl);
  const [frameCount, setFrameCount] = useState<number | null>(props.frameCount);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [windowSec, setWindowSec] = useState(30); // annotation viewport size (paging only)
  const [frameInput, setFrameInput] = useState(""); // "go to frame" box
  const [pendingIn, setPendingIn] = useState<number | null>(null);
  const [pendingOut, setPendingOut] = useState<number | null>(null);

  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [showOverlay, setShowOverlay] = useState(true); // live label HUD on the video

  const selectedTask = tasks.find((t) => t.id === selectedTaskId) ?? null;

  const flash = useCallback((m: string) => {
    setToast(m);
    window.setTimeout(() => setToast(null), 1800);
  }, []);

  // ── video wiring ──────────────────────────────────────────────────────────
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => setCurrentFrame(Math.round(v.currentTime * fps));
    const onMeta = () => {
      if (v.duration && isFinite(v.duration)) {
        setFrameCount((fc) => fc ?? Math.round(v.duration * fps));
      }
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("loadedmetadata", onMeta);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    return () => {
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("loadedmetadata", onMeta);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
    };
  }, [fps]);

  // Remember each annotator's preferred window size across reloads (per-browser,
  // so it stays an individual preference — not a batch-wide setting).
  useEffect(() => {
    const saved = Number(window.localStorage.getItem("kosha.windowSec"));
    if (saved > 0) setWindowSec(saved);
  }, []);
  const changeWindowSec = useCallback((v: number) => {
    setWindowSec(v);
    window.localStorage.setItem("kosha.windowSec", String(v));
  }, []);

  const seekFrame = useCallback(
    (frame: number) => {
      const f = Math.max(0, frame);
      setCurrentFrame(f); // update UI first, independent of media readiness
      const v = videoRef.current;
      if (!v) return;
      try {
        v.currentTime = frameToTime(f, fps) + 0.0001;
      } catch {
        // media not seekable yet (not loaded) — the frame readout still moves
      }
    },
    [fps],
  );

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    // play() returns a promise; if a pause()/seek interrupts it (rapid toggles,
    // stepping while playing) the browser rejects with AbortError. Ignore it.
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  }, []);

  // Keep focus off transport buttons: a focused button ALSO activates on Space,
  // which together with the global Space shortcut caused a double play/pause
  // (the AbortError). preventDefault on mousedown stops the click from focusing.
  const keepFocus = useCallback((e: React.MouseEvent) => e.preventDefault(), []);

  function changeRate(r: number) {
    const v = videoRef.current;
    if (v) v.playbackRate = r;
    setRate(r);
  }

  // Re-fetch the true saved tasks from the server into local state, WITHOUT
  // touching the video (unlike router.refresh, which would reload it). Used to
  // correct the screen after a rejected save so it never shows unsaved edits.
  const resyncTasks = useCallback(async () => {
    try {
      const { tasks: db } = await api(`/api/assignments/${assignmentId}/tasks`, "GET");
      setTasks(
        (db as any[]).map((t) => ({
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
          subTasks: (t.subTasks as any[]).map((s) => ({
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
        })),
      );
    } catch {
      /* leave state as-is if the resync itself fails */
    }
  }, [assignmentId]);

  // ── debounced persistence for task/subtask field edits ────────────────────
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const pending = useRef<Record<string, { kind: "task" | "subtask"; patch: Record<string, unknown> }>>({});

  // Persist one entity's pending patch NOW. Throws on failure so callers/flush
  // can react. Only re-syncs on a permission error (stale session) — never on a
  // validation error (400), which would clobber the value you're mid-editing.
  const doSave = useCallback(
    async (id: string) => {
      const entry = pending.current[id];
      if (!entry) return;
      delete pending.current[id];
      clearTimeout(timers.current[id]);
      const url = entry.kind === "task" ? `/api/tasks/${id}` : `/api/subtasks/${id}`;
      setSaving(true);
      try {
        await api(url, "PATCH", entry.patch);
      } catch (e) {
        flash((e as Error).message);
        if ((e as { status?: number }).status === 403) resyncTasks();
        throw e;
      } finally {
        setSaving(false);
      }
    },
    [flash, resyncTasks],
  );

  const scheduleSave = useCallback(
    (kind: "task" | "subtask", id: string, patch: Record<string, unknown>) => {
      pending.current[id] = {
        kind,
        patch: { ...(pending.current[id]?.patch ?? {}), ...patch },
      };
      clearTimeout(timers.current[id]);
      timers.current[id] = setTimeout(() => {
        doSave(id).catch(() => {});
      }, 500);
    },
    [doSave],
  );

  // Fire all pending debounced saves immediately and wait. Returns true if any
  // failed. Called before Submit so it validates the real, current edits.
  const flushSaves = useCallback(async (): Promise<boolean> => {
    const ids = Object.keys(pending.current);
    const results = await Promise.allSettled(ids.map((id) => doSave(id)));
    return results.some((r) => r.status === "rejected");
  }, [doSave]);

  // ── task ops ──────────────────────────────────────────────────────────────
  const createTask = useCallback(async (fill = false) => {
    if (!editable) return;
    let start: number;
    let end: number;
    if (fill) {
      // Fill the first gap BETWEEN existing L1 tasks. (Gaps between tasks are
      // allowed to stay empty per the guideline — this only helps when the
      // annotator actually missed a task there. Created unlabeled.)
      const sorted = [...tasks].sort((a, b) => a.startFrame - b.startFrame);
      let gap: [number, number] | null = null;
      for (let i = 0; i < sorted.length - 1; i++) {
        if (sorted[i + 1].startFrame > sorted[i].endFrame) {
          gap = [sorted[i].endFrame, sorted[i + 1].startFrame];
          break;
        }
      }
      if (!gap) {
        flash("No gap between existing tasks to fill.");
        return;
      }
      [start, end] = gap;
    } else {
      start = pendingIn ?? currentFrame;
      end = pendingOut ?? Math.round(start + fps * 2);
      if (end <= start) end = start + Math.round(fps * 2);
    }
    setSaving(true);
    try {
      const { task } = await api(
        `/api/assignments/${assignmentId}/tasks`,
        "POST",
        { startFrame: start, endFrame: end },
      );
      const withSubs: Task = { ...task, qualityFlags: [], subTasks: [] };
      setTasks((prev) => [...prev, withSubs].sort((a, b) => a.startFrame - b.startFrame));
      setSelectedTaskId(task.id);
      setPendingIn(null);
      setPendingOut(null);
      setTab("tasks");
      if (status === "ASSIGNED") setStatus("IN_PROGRESS");
      flash("Task created");
    } catch (e) {
      flash((e as Error).message);
    } finally {
      setSaving(false);
    }
  }, [editable, pendingIn, pendingOut, currentFrame, fps, assignmentId, status, flash, tasks]);

  const updateTask = useCallback(
    (id: string, patch: Partial<Task>) => {
      setTasks((prev) =>
        prev
          .map((t) => (t.id === id ? { ...t, ...patch } : t))
          .sort((a, b) => a.startFrame - b.startFrame),
      );
      scheduleSave("task", id, patch as Record<string, unknown>);
    },
    [scheduleSave],
  );

  const deleteTask = useCallback(
    async (id: string) => {
      if (!confirm("Delete this task and its sub-tasks?")) return;
      const prev = tasks;
      setTasks((p) => p.filter((t) => t.id !== id));
      if (selectedTaskId === id) setSelectedTaskId(null);
      try {
        await api(`/api/tasks/${id}`, "DELETE");
        flash("Task deleted");
      } catch (e) {
        flash((e as Error).message);
        setTasks(prev);
      }
    },
    [tasks, selectedTaskId, flash],
  );

  // ── sub-task ops ──────────────────────────────────────────────────────────
  const createSub = useCallback(async (label = "", fill = false) => {
    if (!editable || !selectedTask) return;
    const t = selectedTask;
    const lastEnd = t.subTasks.reduce((m, s) => Math.max(m, s.endFrame), t.startFrame);
    let start: number;
    let end: number;
    if (fill) {
      // idle_wait / gap fill: cover the FIRST gap in the tiling (interior or
      // trailing), not just the end — so mid-task pauses close in one click.
      const gap = coverage(t).gaps[0];
      if (!gap) {
        flash("Task is already fully covered.");
        return;
      }
      [start, end] = gap;
    } else {
      start = Math.max(t.startFrame, Math.min(currentFrame, t.endFrame - 1));
      if (start < lastEnd && lastEnd < t.endFrame) start = lastEnd; // continue tiling
      end = Math.min(t.endFrame, start + Math.round(fps));
      if (end <= start) end = Math.min(t.endFrame, start + 1);
    }
    setSaving(true);
    try {
      const { subTask } = await api(`/api/tasks/${t.id}/subtasks`, "POST", {
        startFrame: start,
        endFrame: end,
        label,
      });
      setTasks((prev) =>
        prev.map((x) =>
          x.id === t.id
            ? { ...x, subTasks: [...x.subTasks, subTask].sort((a, b) => a.startFrame - b.startFrame) }
            : x,
        ),
      );
      setSelectedSubId(subTask.id);
      flash("Sub-task created");
    } catch (e) {
      flash((e as Error).message);
    } finally {
      setSaving(false);
    }
  }, [editable, selectedTask, currentFrame, fps, flash]);

  const updateSub = useCallback(
    (id: string, patch: Partial<SubTask>) => {
      setTasks((prev) =>
        prev.map((t) => ({
          ...t,
          subTasks: t.subTasks
            .map((s) => (s.id === id ? { ...s, ...patch } : s))
            .sort((a, b) => a.startFrame - b.startFrame),
        })),
      );
      scheduleSave("subtask", id, patch as Record<string, unknown>);
    },
    [scheduleSave],
  );

  const deleteSub = useCallback(
    async (id: string) => {
      const prev = tasks;
      setTasks((p) =>
        p.map((t) => ({ ...t, subTasks: t.subTasks.filter((s) => s.id !== id) })),
      );
      if (selectedSubId === id) setSelectedSubId(null);
      try {
        await api(`/api/subtasks/${id}`, "DELETE");
        flash("Sub-task deleted");
      } catch (e) {
        flash((e as Error).message);
        setTasks(prev);
      }
    },
    [tasks, selectedSubId, flash],
  );

  // ── quality ops ───────────────────────────────────────────────────────────
  const upsertQuality = useCallback(
    async (frameIndex: number, patch: Partial<FrameQuality>) => {
      if (!editable) return;
      setQuality((prev) => {
        const base: FrameQuality =
          prev[frameIndex] ??
          {
            frameIndex,
            realWork: true,
            repetitive: false,
            occluded: false,
            smudge: false,
            glare: false,
            blur: false,
            notes: "",
          };
        return { ...prev, [frameIndex]: { ...base, ...patch } };
      });
      try {
        await api(`/api/assignments/${assignmentId}/frame-quality`, "PUT", {
          frameIndex,
          ...patch,
        });
      } catch (e) {
        flash((e as Error).message);
      }
    },
    [editable, assignmentId, flash],
  );

  // ── status transitions ────────────────────────────────────────────────────
  async function transition(action: "submit" | "approve" | "reject") {
    if (action === "reject" && !reviewNote.trim()) {
      flash("Add a note so the annotator knows what to fix.");
      return;
    }
    // Push any pending edits to the server BEFORE submitting, so Submit validates
    // exactly what's on screen (not stale debounced state). If an edit can't save
    // (e.g. a frame outside the task span), stop and show why — don't submit.
    if (action === "submit") {
      const anyFailed = await flushSaves();
      if (anyFailed) {
        flash("Some edits couldn't save — fix the highlighted field, then submit.");
        return;
      }
    }
    setSaving(true);
    try {
      const { assignment } = await api(
        `/api/assignments/${assignmentId}/status`,
        "POST",
        { action, reviewNote },
      );
      setStatus(assignment.status);
      setReviewNote(assignment.reviewNote ?? reviewNote);
      flash(`Task ${assignment.status.toLowerCase()}`);
      router.refresh();
    } catch (e) {
      flash((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  // ── keyboard ──────────────────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT"))
        return;
      if (e.key === " ") {
        e.preventDefault();
        if (!e.repeat) togglePlay(); // ignore auto-repeat while Space is held
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        seekFrame(currentFrame - (e.shiftKey ? 10 : 1));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        seekFrame(currentFrame + (e.shiftKey ? 10 : 1));
      } else if (e.key.toLowerCase() === "i") {
        setPendingIn(currentFrame);
        flash(`In: frame ${currentFrame}`);
      } else if (e.key.toLowerCase() === "o") {
        setPendingOut(currentFrame);
        flash(`Out: frame ${currentFrame}`);
      } else if (e.key === "Escape") {
        setPendingIn(null);
        setPendingOut(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [currentFrame, togglePlay, seekFrame, flash]);

  // ── live QA (guideline §6) ────────────────────────────────────────────────
  const validation = validateSubmission({
    fps,
    tasks: tasks.map((t) => ({
      label: t.label,
      difficulty: t.difficulty,
      venueL2: t.venueL2,
      venueL3: t.venueL3,
      job: t.job,
      qualityFlags: t.qualityFlags,
      startFrame: t.startFrame,
      endFrame: t.endFrame,
      subTasks: t.subTasks.map((s) => ({
        label: s.label,
        description: s.description,
        startFrame: s.startFrame,
        endFrame: s.endFrame,
      })),
    })),
    reviewedQFrames: Object.keys(quality).length,
    totalQFrames: frameCount ? sampledFrames(frameCount, props.sampleEveryN).length : 0,
  });
  const blocked = validation.errors.length > 0;

  // ── timeline geometry ─────────────────────────────────────────────────────
  const fc = frameCount ?? 0;
  const pct = (f: number) => (fc > 0 ? (f / fc) * 100 : 0);

  function onTimelineClick(e: React.MouseEvent<HTMLDivElement>) {
    if (fc <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    seekFrame(Math.round(((e.clientX - rect.left) / rect.width) * fc));
  }

  // ── annotation windows (viewport paging over the continuous session) ───────
  // Data stays session-global; windows only make a long (e.g. 2-hour) session
  // digestible. Playback runs straight through them — the indicator follows the
  // playhead. Task/sub-task spans and duration checks are unaffected.
  const windowFrames = Math.max(1, Math.round(windowSec * (fps || 30)));
  const windowCount = fc > 0 ? Math.ceil(fc / windowFrames) : 1;
  const currentWindow = Math.min(windowCount - 1, Math.floor(currentFrame / windowFrames));
  const windowStart = currentWindow * windowFrames;
  const windowEnd = Math.min(windowStart + windowFrames, fc);
  const gotoWindow = (w: number) => seekFrame(Math.max(0, Math.min(windowCount - 1, w)) * windowFrames);
  const tc = (f: number) => {
    const s = Math.floor(f / (fps || 30));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };
  const windowed = fc > windowFrames;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_400px]">
      {/* Left: video + timeline */}
      <div className="min-w-0">
        <div className="mb-2 flex items-center justify-between">
          <h1 className="truncate text-lg font-semibold text-white">{props.clipTitle}</h1>
          <span className="text-xs text-slate-500">
            {fps} fps · {props.videoSource === "r2" ? "R2" : "direct"} ·{" "}
            {fc ? `${fc} frames` : "loading…"}
          </span>
        </div>

        <div className="relative overflow-hidden rounded-lg border border-ink-700 bg-black">
          <video
            ref={videoRef}
            src={videoUrl}
            className="aspect-video w-full bg-black"
            onClick={togglePlay}
            playsInline
          />
          {showOverlay && (
            <VideoOverlay tasks={tasks} quality={quality} currentFrame={currentFrame} />
          )}
        </div>

        {/* transport */}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button onMouseDown={keepFocus} onClick={togglePlay} className="btn-ghost w-20">
            {playing ? "❚❚ Pause" : "▶ Play"}
          </button>
          <button
            onMouseDown={keepFocus}
            onClick={() => setShowOverlay((v) => !v)}
            title="Toggle the live label overlay on the video"
            className={`btn-ghost ${showOverlay ? "text-brand-400" : "text-slate-500"}`}
          >
            ⊞ Overlay
          </button>
          <button onMouseDown={keepFocus} onClick={() => seekFrame(currentFrame - 10)} className="btn-ghost">−10f</button>
          <button onMouseDown={keepFocus} onClick={() => seekFrame(currentFrame - 1)} className="btn-ghost">−1f</button>
          <button onMouseDown={keepFocus} onClick={() => seekFrame(currentFrame + 1)} className="btn-ghost">+1f</button>
          <button onMouseDown={keepFocus} onClick={() => seekFrame(currentFrame + 10)} className="btn-ghost">+10f</button>
          <div className="rounded-md bg-ink-800 px-3 py-1.5 font-mono text-sm text-slate-200">
            frame <span className="text-brand-400">{currentFrame}</span>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const n = parseInt(frameInput, 10);
              if (Number.isFinite(n)) seekFrame(fc > 0 ? Math.max(0, Math.min(n, fc - 1)) : Math.max(0, n));
              setFrameInput("");
            }}
            className="flex items-center gap-1"
          >
            <input
              type="number"
              min={0}
              max={fc || undefined}
              value={frameInput}
              onChange={(e) => setFrameInput(e.target.value)}
              placeholder="go to frame #"
              className="input w-28 font-mono text-sm"
            />
            <button type="submit" className="btn-ghost text-xs" disabled={frameInput === ""}>
              Go
            </button>
          </form>
          <div className="ml-auto flex gap-1">
            {[0.25, 0.5, 1, 1.5, 2].map((r) => (
              <button
                key={r}
                onMouseDown={keepFocus}
                onClick={() => changeRate(r)}
                className={`rounded px-2 py-1 text-xs ${
                  rate === r ? "bg-brand-600 text-white" : "bg-ink-800 text-slate-300"
                }`}
              >
                {r}×
              </button>
            ))}
          </div>
        </div>

        {/* annotation window pager (viewport only — session stays continuous) */}
        {windowed && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-ink-700 bg-ink-900 px-3 py-2 text-xs">
            <button
              className="btn-ghost px-2 py-1"
              onClick={() => gotoWindow(currentWindow - 1)}
              disabled={currentWindow <= 0}
            >
              ◀ prev {windowSec}s
            </button>
            <span className="font-mono text-slate-300">
              Window {currentWindow + 1}/{windowCount} ·{" "}
              <span className="text-brand-400">{tc(windowStart)}–{tc(windowEnd)}</span>{" "}
              <span className="text-slate-500">(f {windowStart}–{windowEnd})</span>
            </span>
            <button
              className="btn-ghost px-2 py-1"
              onClick={() => gotoWindow(currentWindow + 1)}
              disabled={currentWindow >= windowCount - 1}
            >
              next {windowSec}s ▶
            </button>
            <input
              type="range"
              min={0}
              max={windowCount - 1}
              value={currentWindow}
              onChange={(e) => gotoWindow(Number(e.target.value))}
              className="min-w-[120px] flex-1"
              title="Jump to window"
            />
            <select
              className="input w-auto py-0.5 text-xs"
              value={windowSec}
              onChange={(e) => changeWindowSec(Number(e.target.value))}
              title="Window size (remembered per annotator)"
            >
              {[15, 30, 60, 120].map((s) => (
                <option key={s} value={s}>
                  {s}s window
                </option>
              ))}
            </select>
          </div>
        )}

        {/* timeline */}
        <div className="mt-3">
          <div
            className="relative h-12 cursor-pointer rounded-md border border-ink-700 bg-ink-900"
            onClick={onTimelineClick}
          >
            {windowed && (
              <div
                className="pointer-events-none absolute top-0 bottom-0 border-x border-white/25 bg-white/5"
                style={{
                  left: `${pct(windowStart)}%`,
                  width: `${Math.max(pct(windowEnd) - pct(windowStart), 0.3)}%`,
                }}
                title={`current window ${tc(windowStart)}–${tc(windowEnd)}`}
              />
            )}
            {tasks.map((t) => (
              <div
                key={t.id}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedTaskId(t.id);
                  seekFrame(t.startFrame);
                }}
                title={`${t.label || "task"} · ${t.startFrame}–${t.endFrame}`}
                className={`absolute top-1 bottom-1 rounded-sm border ${
                  selectedTaskId === t.id ? "border-white bg-brand-600/70" : "border-black/40 bg-brand-600/40"
                }`}
                style={{ left: `${pct(t.startFrame)}%`, width: `${Math.max(pct(t.endFrame) - pct(t.startFrame), 0.5)}%` }}
              />
            ))}
            {pendingIn != null && (
              <div className="pointer-events-none absolute top-0 bottom-0 w-0.5 bg-emerald-400" style={{ left: `${pct(pendingIn)}%` }} />
            )}
            {pendingOut != null && (
              <div className="pointer-events-none absolute top-0 bottom-0 w-0.5 bg-emerald-600" style={{ left: `${pct(pendingOut)}%` }} />
            )}
            <div className="pointer-events-none absolute top-0 bottom-0 w-0.5 bg-red-500" style={{ left: `${pct(currentFrame)}%` }} />
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-slate-600">
            <span>0</span>
            <span>
              In {pendingIn ?? "–"} · Out {pendingOut ?? "–"} (keys I / O)
            </span>
            <span>{fc}</span>
          </div>
        </div>

        <p className="mt-2 text-xs text-slate-500">
          <b>Space</b> play/pause · <b>←/→</b> step 1f (Shift 10f) · <b>I/O</b> mark
          in/out · <b>Esc</b> clear
        </p>
      </div>

      {/* Right: tabbed panels */}
      <aside className="space-y-3">
        <div className="flex gap-1 rounded-md border border-ink-700 bg-ink-900 p-1 text-sm">
          {(["tasks", "subtasks", "quality"] as Tab[]).map((tk) => (
            <button
              key={tk}
              onClick={() => setTab(tk)}
              className={`flex-1 rounded px-2 py-1.5 capitalize ${
                tab === tk ? "bg-brand-600 text-white" : "text-slate-300 hover:bg-ink-800"
              }`}
            >
              {tk === "subtasks" ? "Sub-tasks" : tk === "quality" ? "Quality" : "Tasks"}
            </button>
          ))}
        </div>

        <div className="card p-3">
          {tab === "tasks" && (
            <TasksPanel
              tasks={tasks}
              selectedId={selectedTaskId}
              currentFrame={currentFrame}
              fps={fps}
              editable={editable}
              taxonomies={props.taxonomies}
              onSelect={setSelectedTaskId}
              onCreate={createTask}
              onUpdate={updateTask}
              onDelete={deleteTask}
              onSeek={seekFrame}
            />
          )}
          {tab === "subtasks" && (
            <SubTasksPanel
              task={selectedTask}
              currentFrame={currentFrame}
              fps={fps}
              editable={editable}
              onCreate={createSub}
              onUpdate={updateSub}
              onDelete={deleteSub}
              onSeek={seekFrame}
              selectedSubId={selectedSubId}
              onSelectSub={setSelectedSubId}
            />
          )}
          {tab === "quality" && (
            <QualityPanel
              frameCount={frameCount}
              sampleEveryN={props.sampleEveryN}
              quality={quality}
              editable={editable}
              onUpsert={upsertQuality}
              onSeek={seekFrame}
              currentFrame={currentFrame}
            />
          )}
        </div>

        {/* status / actions */}
        <div className="card p-3">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="text-xs uppercase tracking-wide text-slate-500">Status</span>
            <span className="text-slate-200">{status}</span>
            <a
              href={`/api/assignments/${assignmentId}/export`}
              className="text-xs text-brand-400 hover:underline"
            >
              Export JSON
            </a>
          </div>

          {/* Reviewer feedback — the annotator sees this after a reject. */}
          {reviewNote.trim() && !canReview && (
            <div
              className={`mb-2 rounded-md border p-2 text-xs ${
                status === "REJECTED"
                  ? "border-red-800/60 bg-red-950/30 text-red-200"
                  : "border-ink-700 bg-ink-950/60 text-slate-300"
              }`}
            >
              <div className="font-medium">Reviewer note</div>
              <div className="mt-0.5 whitespace-pre-wrap">{reviewNote}</div>
            </div>
          )}
          {editable && (validation.errors.length > 0 || validation.warnings.length > 0) && (
            <div className="mb-2 space-y-1 rounded-md border border-ink-700 bg-ink-950/60 p-2 text-[11px]">
              <div className="font-medium text-slate-300">
                QA checklist ({validation.errors.length} blocking ·{" "}
                {validation.warnings.length} to review)
              </div>
              {validation.errors.slice(0, 5).map((e, i) => (
                <div key={`e${i}`} className="text-red-400">✗ {e.message}</div>
              ))}
              {validation.warnings.slice(0, 5).map((w, i) => (
                <div key={`w${i}`} className="text-amber-400">• {w.message}</div>
              ))}
            </div>
          )}
          <div className="space-y-2">
            {editable && (
              <button
                onClick={() => transition("submit")}
                disabled={saving || status === "SUBMITTED" || blocked}
                title={blocked ? "Resolve blocking QA issues first" : undefined}
                className="btn-primary w-full"
              >
                {status === "SUBMITTED"
                  ? "Submitted"
                  : blocked
                    ? `Fix ${validation.errors.length} issue(s) to submit`
                    : "Submit for review"}
              </button>
            )}
            {canReview && (
              <div className="space-y-2">
                <textarea
                  className="input min-h-[54px] text-xs"
                  placeholder="Review note (required to reject — tell the annotator what to fix)"
                  value={reviewNote}
                  onChange={(e) => setReviewNote(e.target.value)}
                />
                <div className="flex gap-2">
                  <button onClick={() => transition("approve")} disabled={saving} className="btn-ghost flex-1 border-green-800/60 text-green-300">
                    Approve
                  </button>
                  <button
                    onClick={() => transition("reject")}
                    disabled={saving || !reviewNote.trim()}
                    title={!reviewNote.trim() ? "Add a note to reject" : undefined}
                    className="btn-danger flex-1"
                  >
                    Reject
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="text-right text-xs text-slate-500">
          {saving ? "Saving…" : "All changes saved"}
        </div>
      </aside>

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-30 -translate-x-1/2 rounded-md bg-ink-700 px-4 py-2 text-sm text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
