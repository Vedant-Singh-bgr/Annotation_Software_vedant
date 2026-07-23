"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { frameToTime, sampledFrames, parseFlags } from "@/lib/kosha";
import { validateSubmission } from "@/lib/validate";
import { Task, SubTask, FrameQuality, Taxonomies, ClipListItem, api, coverage } from "./shared";
import AnnotationsPanel from "./AnnotationsPanel";
import QualityPanel from "./QualityPanel";
import VideoOverlay from "./VideoOverlay";
import TimelineBoard from "./TimelineBoard";
import ClipsSidebar from "./ClipsSidebar";
import StatusBadge from "@/components/StatusBadge";

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
  clips: ClipListItem[];
};

type Tab = "annotations" | "quality";

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
  const [tab, setTab] = useState<Tab>("annotations");
  // Annotations panel drill-down: "list" shows the outline, "editor" swaps the
  // whole panel to the selected item's detail form.
  const [panelView, setPanelView] = useState<"list" | "editor">("list");
  // QA checklist disclosure — collapsed by default, the counts tell the story.
  const [checklistOpen, setChecklistOpen] = useState(false);

  // Pin the presigned video URL to its first value. It's valid for R2_URL_TTL
  // (~1h); freezing it means re-renders/refreshes never swap the <video> src and
  // snap playback back to frame 0.
  const [videoUrl] = useState(props.videoUrl);
  const [frameCount, setFrameCount] = useState<number | null>(props.frameCount);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [windowSec, setWindowSec] = useState(30); // annotation viewport size (paging only)
  const [pendingIn, setPendingIn] = useState<number | null>(null);
  const [pendingOut, setPendingOut] = useState<number | null>(null);

  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [showOverlay, setShowOverlay] = useState(true); // live label HUD on the video

  const selectedTask = tasks.find((t) => t.id === selectedTaskId) ?? null;

  // Mirror of `tasks` for callbacks that must read the freshest state without
  // re-binding (drag commits, keyboard nudges).
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;

  const flash = useCallback((m: string) => {
    setToast(m);
    window.setTimeout(() => setToast(null), 1800);
  }, []);

  // Scroll the detail editor for the current selection into view (used after
  // timeline clicks and task creation, so focus keeps flowing).
  const scrollEditorIntoView = useCallback((which: "task" | "sub") => {
    // Wait one tick so the panel for the new selection is mounted first.
    window.setTimeout(() => {
      document
        .getElementById(which === "task" ? "kosha-task-editor" : "kosha-sub-editor")
        ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 80);
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
      setTab("annotations");
      setPanelView("editor");
      if (status === "ASSIGNED") setStatus("IN_PROGRESS");
      scrollEditorIntoView("task"); // keep focus flowing straight into the editor
      flash("Task created");
    } catch (e) {
      flash((e as Error).message);
    } finally {
      setSaving(false);
    }
  }, [editable, pendingIn, pendingOut, currentFrame, fps, assignmentId, status, flash, tasks, scrollEditorIntoView]);

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

  // ── selection (timeline blocks + outline rows share one model) ───────────
  const selectTaskInPanel = useCallback((id: string) => {
    setSelectedTaskId(id);
    setSelectedSubId(null);
  }, []);

  const selectSubInPanel = useCallback((taskId: string, subId: string) => {
    setSelectedTaskId(taskId);
    setSelectedSubId(subId);
  }, []);

  const selectTaskFromBoard = useCallback(
    (id: string) => {
      setSelectedTaskId(id);
      setSelectedSubId(null);
      setTab("annotations");
      setPanelView("editor");
      scrollEditorIntoView("task");
    },
    [scrollEditorIntoView],
  );

  const selectSubFromBoard = useCallback(
    (taskId: string, subId: string) => {
      setSelectedTaskId(taskId);
      setSelectedSubId(subId);
      setTab("annotations");
      setPanelView("editor");
      scrollEditorIntoView("sub");
    },
    [scrollEditorIntoView],
  );

  // ── drag commit (timeline blocks) ─────────────────────────────────────────
  // Optimistic: local state is set to the dragged span immediately; the PATCH
  // goes through the existing endpoints; on failure we revert to the pre-drag
  // snapshot. Moving a task shifts its sub-tasks along (containment preserved:
  // task span is widened/committed first, then children).
  const commitDrag = useCallback(
    async (
      kind: "task" | "subtask",
      id: string,
      next: { startFrame: number; endFrame: number },
      mode: "move" | "start" | "end",
    ) => {
      const snapshot = tasksRef.current;
      // Drop any queued debounced frame edits for this entity so a stale
      // debounce doesn't clobber the drag result 500ms later.
      if (pending.current[id]) {
        delete pending.current[id].patch.startFrame;
        delete pending.current[id].patch.endFrame;
      }
      if (kind === "task") {
        const t = snapshot.find((x) => x.id === id);
        if (!t || (t.startFrame === next.startFrame && t.endFrame === next.endFrame)) return;
        const delta = next.startFrame - t.startFrame;
        const shiftKids = mode === "move" && delta !== 0 && t.subTasks.length > 0;
        setTasks((prev) =>
          prev
            .map((x) =>
              x.id === id
                ? {
                    ...x,
                    ...next,
                    subTasks: shiftKids
                      ? x.subTasks.map((s) => ({
                          ...s,
                          startFrame: s.startFrame + delta,
                          endFrame: s.endFrame + delta,
                        }))
                      : x.subTasks,
                  }
                : x,
            )
            .sort((a, b) => a.startFrame - b.startFrame),
        );
        setSaving(true);
        try {
          await api(`/api/tasks/${id}`, "PATCH", next);
          if (shiftKids) {
            await Promise.all(
              t.subTasks.map((s) =>
                api(`/api/subtasks/${s.id}`, "PATCH", {
                  startFrame: s.startFrame + delta,
                  endFrame: s.endFrame + delta,
                }),
              ),
            );
          }
        } catch (e) {
          flash((e as Error).message);
          setTasks(snapshot);
          if (shiftKids) resyncTasks(); // some children may have moved — take server truth
        } finally {
          setSaving(false);
        }
      } else {
        const parent = snapshot.find((x) => x.subTasks.some((s) => s.id === id));
        const s0 = parent?.subTasks.find((s) => s.id === id);
        if (!s0 || (s0.startFrame === next.startFrame && s0.endFrame === next.endFrame)) return;
        setTasks((prev) =>
          prev.map((x) => ({
            ...x,
            subTasks: x.subTasks
              .map((s) => (s.id === id ? { ...s, ...next } : s))
              .sort((a, b) => a.startFrame - b.startFrame),
          })),
        );
        setSaving(true);
        try {
          await api(`/api/subtasks/${id}`, "PATCH", next);
        } catch (e) {
          flash((e as Error).message);
          setTasks(snapshot);
        } finally {
          setSaving(false);
        }
      }
    },
    [flash, resyncTasks],
  );

  // ── keyboard nudge for the selected block ([ / ] keys) ────────────────────
  const nudge = useCallback(
    (edge: "start" | "end", delta: number) => {
      if (!editable) return;
      const clampN = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
      const t = tasksRef.current.find((x) => x.id === selectedTaskId);
      if (!t) return;
      const sub = t.subTasks.find((s) => s.id === selectedSubId) ?? null;
      const fcMax = (frameCount ?? 0) > 0 ? (frameCount as number) : Number.POSITIVE_INFINITY;
      if (sub) {
        if (edge === "start") {
          const v = clampN(sub.startFrame + delta, t.startFrame, sub.endFrame - 1);
          if (v !== sub.startFrame) updateSub(sub.id, { startFrame: v });
        } else {
          const v = clampN(sub.endFrame + delta, sub.startFrame + 1, t.endFrame);
          if (v !== sub.endFrame) updateSub(sub.id, { endFrame: v });
        }
      } else {
        const subMin = t.subTasks.length
          ? Math.min(...t.subTasks.map((s) => s.startFrame))
          : Number.POSITIVE_INFINITY;
        const subMax = t.subTasks.length
          ? Math.max(...t.subTasks.map((s) => s.endFrame))
          : Number.NEGATIVE_INFINITY;
        if (edge === "start") {
          const v = clampN(t.startFrame + delta, 0, Math.min(t.endFrame - 1, subMin));
          if (v !== t.startFrame) updateTask(t.id, { startFrame: v });
        } else {
          const v = clampN(t.endFrame + delta, Math.max(t.startFrame + 1, subMax), fcMax);
          if (v !== t.endFrame) updateTask(t.id, { endFrame: v });
        }
      }
    },
    [editable, selectedTaskId, selectedSubId, updateTask, updateSub, frameCount],
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
      flash(`Task ${assignment.status.toLowerCase().replace(/_/g, " ")}`);
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
      } else if (e.code === "BracketLeft" || e.code === "BracketRight") {
        // [ / ] nudge the selected block's start/end by 1 frame (Shift = 10).
        // Default grows the span outward; Alt reverses to trim inward.
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const edge = e.code === "BracketLeft" ? ("start" as const) : ("end" as const);
        const dir = (e.code === "BracketLeft" ? -1 : 1) * (e.altKey ? -1 : 1);
        nudge(edge, dir * step);
      } else if (e.key === "Escape") {
        setPendingIn(null);
        setPendingOut(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [currentFrame, togglePlay, seekFrame, flash, nudge]);

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

  // Queue position for Prev/Next clip walking (sidebar order).
  const qIdx = props.clips.findIndex((c) => c.assignmentId === assignmentId);
  const prevClip = qIdx > 0 ? props.clips[qIdx - 1] : null;
  const nextClip = qIdx >= 0 && qIdx < props.clips.length - 1 ? props.clips[qIdx + 1] : null;

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
    <div className="flex items-start gap-4">
      {/* Far left: clip queue for fast switching */}
      {props.clips.length > 0 && (
        <ClipsSidebar clips={props.clips} currentId={assignmentId} />
      )}

      <div className="grid min-w-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
      {/* Left: video + timeline */}
      <div className="min-w-0">
        <div className="mb-2 flex items-center gap-3">
          <h1 className="min-w-0 truncate font-serif text-lg text-ink-900">{props.clipTitle}</h1>
          <span className="ml-auto shrink-0 text-xs text-ink-500">
            {fps} fps · {props.videoSource === "r2" ? "R2" : "direct"} ·{" "}
            {fc ? `${fc} frames` : "loading…"}
          </span>
          {props.clips.length > 1 && (
            <div className="flex shrink-0 gap-1">
              <button
                className="btn-ghost h-7 px-2 text-xs"
                disabled={!prevClip}
                title={prevClip ? `Previous clip: ${prevClip.title}` : "First clip in your queue"}
                onClick={() => prevClip && router.push(`/annotate/${prevClip.assignmentId}`)}
              >
                ← Prev
              </button>
              <button
                className="btn-ghost h-7 px-2 text-xs"
                disabled={!nextClip}
                title={nextClip ? `Next clip: ${nextClip.title}` : "Last clip in your queue"}
                onClick={() => nextClip && router.push(`/annotate/${nextClip.assignmentId}`)}
              >
                Next →
              </button>
            </div>
          )}
        </div>

        <div className="relative overflow-hidden rounded-lg border border-ink-900/10 bg-black">
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

        {/* transport: one segmented cluster + click-to-edit frame readout */}
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <button
            onMouseDown={keepFocus}
            onClick={() => setShowOverlay((v) => !v)}
            title="Toggle the live label overlay on the video"
            className={`btn-ghost h-9 px-2.5 text-sm ${showOverlay ? "text-accent-blue" : "text-ink-400"}`}
          >
            ⊞
          </button>
          <div className="flex h-9 items-stretch divide-x divide-ink-900/10 overflow-hidden rounded-lg border border-ink-900/10">
            <button
              onMouseDown={keepFocus}
              onClick={togglePlay}
              title="Play / pause (Space)"
              className="w-12 text-sm text-ink-800 transition-colors duration-150 hover:bg-ink-900/5"
            >
              {playing ? "❚❚" : "▶"}
            </button>
            {[-10, -1, 1, 10].map((d) => {
              const big = Math.abs(d) === 10;
              return (
                <button
                  key={d}
                  onMouseDown={keepFocus}
                  onClick={() => seekFrame(currentFrame + d)}
                  title={`${d > 0 ? "Forward" : "Back"} ${Math.abs(d)} frame${big ? "s" : ""} (${big ? "Shift+" : ""}${d > 0 ? "→" : "←"})`}
                  className="px-2.5 text-sm text-ink-800 transition-colors duration-150 hover:bg-ink-900/5"
                >
                  {d < 0 ? (big ? "‹‹" : "‹") : big ? "››" : "›"}
                  {big && <sup className="ml-0.5 text-[9px] text-ink-400">10</sup>}
                </button>
              );
            })}
          </div>
          <FrameReadout currentFrame={currentFrame} frameCount={fc} onSeek={seekFrame} />
          <div className="ml-auto flex gap-1">
            {[0.25, 0.5, 1, 1.5, 2].map((r) => (
              <button
                key={r}
                onMouseDown={keepFocus}
                onClick={() => changeRate(r)}
                className={`rounded-lg border px-2 py-1 text-xs transition-colors duration-150 ${
                  rate === r
                    ? "border-accent-blue/60 bg-accent-blue/5 text-ink-900"
                    : "border-transparent text-ink-600 hover:bg-ink-900/5"
                }`}
              >
                {r}×
              </button>
            ))}
          </div>
        </div>

        {/* annotation window pager (viewport only — session stays continuous) */}
        {windowed && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-ink-900/10 bg-paper-50 px-3 py-2 text-xs">
            <button
              className="btn-ghost px-2 py-1"
              onClick={() => gotoWindow(currentWindow - 1)}
              disabled={currentWindow <= 0}
            >
              ◀ prev {windowSec}s
            </button>
            <span className="font-mono tabular-nums text-ink-700">
              Window {currentWindow + 1}/{windowCount} ·{" "}
              <span className="text-accent-blue">{tc(windowStart)}–{tc(windowEnd)}</span>{" "}
              <span className="text-ink-500">(f {windowStart}–{windowEnd})</span>
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

        {/* streamed multi-lane timeline: every task/sub-task always visible */}
        <TimelineBoard
          tasks={tasks}
          frameCount={fc}
          fps={fps}
          currentFrame={currentFrame}
          editable={editable}
          selectedTaskId={selectedTaskId}
          selectedSubId={selectedSubId}
          pendingIn={pendingIn}
          pendingOut={pendingOut}
          windowRange={windowed ? [windowStart, windowEnd] : null}
          onSeek={seekFrame}
          onSelectTask={selectTaskFromBoard}
          onSelectSub={selectSubFromBoard}
          onCommitDrag={commitDrag}
        />

        <p className="mt-2 text-xs text-ink-500">
          <kbd className="rounded border border-ink-900/15 bg-ink-900/[0.04] px-1 text-[11px] text-ink-600">Space</kbd> play/pause ·{" "}
          <kbd className="rounded border border-ink-900/15 bg-ink-900/[0.04] px-1 text-[11px] text-ink-600">←/→</kbd> step 1f (Shift 10f) ·{" "}
          <kbd className="rounded border border-ink-900/15 bg-ink-900/[0.04] px-1 text-[11px] text-ink-600">I/O</kbd> mark in/out{" "}
          <span className="text-ink-400">(In {pendingIn ?? "–"} · Out {pendingOut ?? "–"})</span> ·{" "}
          <kbd className="rounded border border-ink-900/15 bg-ink-900/[0.04] px-1 text-[11px] text-ink-600">[/]</kbd> grow selected start/end 1f
          <span className="text-ink-400"> (Shift 10f, Alt trims)</span> ·{" "}
          <kbd className="rounded border border-ink-900/15 bg-ink-900/[0.04] px-1 text-[11px] text-ink-600">Esc</kbd> clear
        </p>
      </div>

      {/* Right: annotations outline + quality, in one card */}
      <aside className="space-y-4">
        <div className="card">
          <div className="flex gap-5 border-b border-ink-900/10 px-4">
            {(["annotations", "quality"] as Tab[]).map((tk) => (
              <button
                key={tk}
                onClick={() => setTab(tk)}
                className={`-mb-px border-b-2 py-2.5 text-sm transition-colors duration-150 ${
                  tab === tk
                    ? "border-ink-900 text-ink-900"
                    : "border-transparent text-ink-500 hover:text-ink-800"
                }`}
              >
                {tk === "annotations" ? "Annotations" : "Quality"}
              </button>
            ))}
          </div>
          <div className="p-4">
            {tab === "annotations" ? (
              <AnnotationsPanel
                tasks={tasks}
                selectedTaskId={selectedTaskId}
                selectedSubId={selectedSubId}
                currentFrame={currentFrame}
                fps={fps}
                editable={editable}
                view={panelView}
                onOpenEditor={() => setPanelView("editor")}
                onBackToList={() => setPanelView("list")}
                taxonomies={props.taxonomies}
                onSelectTask={selectTaskInPanel}
                onSelectSub={selectSubInPanel}
                onCreateTask={createTask}
                onUpdateTask={updateTask}
                onDeleteTask={deleteTask}
                onCreateSub={createSub}
                onUpdateSub={updateSub}
                onDeleteSub={deleteSub}
                onSeek={seekFrame}
              />
            ) : (
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
        </div>

        {/* status / checklist / actions */}
        <div className="card p-4">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-500">
              Status
            </span>
            <div className="flex items-center gap-3">
              <StatusBadge status={status} />
              <a href={`/api/assignments/${assignmentId}/export`} className="link text-xs">
                Export JSON
              </a>
            </div>
          </div>

          {/* Reviewer feedback — the annotator sees this after a reject. */}
          {reviewNote.trim() && !canReview && (
            <div className="mt-4 border-t border-ink-900/10 pt-3">
              <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-500">
                Reviewer note
              </div>
              <p
                className={`mt-1 whitespace-pre-wrap text-sm leading-snug ${
                  status === "REJECTED" ? "text-accent-red" : "text-ink-700"
                }`}
              >
                {reviewNote}
              </p>
            </div>
          )}

          {editable && (validation.errors.length > 0 || validation.warnings.length > 0) && (
            <div className="mt-4 border-t border-ink-900/10 pt-3">
              <button
                onClick={() => setChecklistOpen((o) => !o)}
                title={checklistOpen ? "Hide checklist items" : "Show checklist items"}
                className="flex w-full items-baseline justify-between text-left"
              >
                <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-500">
                  <span
                    className={`mr-1 inline-block text-[10px] transition-transform duration-150 ${
                      checklistOpen ? "rotate-90" : ""
                    }`}
                  >
                    ›
                  </span>
                  Checklist
                </span>
                <span className="text-xs tabular-nums text-ink-500">
                  {validation.errors.length > 0 && (
                    <span className="text-accent-red">{validation.errors.length} blocking</span>
                  )}
                  {validation.errors.length > 0 && validation.warnings.length > 0 && " · "}
                  {validation.warnings.length > 0 && `${validation.warnings.length} to review`}
                </span>
              </button>
              {checklistOpen && (
                <ul className="mt-2 max-h-56 space-y-1.5 overflow-y-auto pr-1">
                  {validation.errors.map((it, i) => (
                    <ChecklistLine key={`e${i}`} kind="error" text={it.message} />
                  ))}
                  {validation.warnings.map((it, i) => (
                    <ChecklistLine key={`w${i}`} kind="warn" text={it.message} />
                  ))}
                </ul>
              )}
            </div>
          )}

          {editable && (
            <div className="mt-4 border-t border-ink-900/10 pt-3">
              {blocked && (
                <p className="mb-2 text-xs tabular-nums">
                  <span className="text-accent-red">
                    {validation.errors.length} blocking issue
                    {validation.errors.length === 1 ? "" : "s"}
                  </span>
                  {validation.warnings.length > 0 && (
                    <span className="text-ink-500"> · {validation.warnings.length} to review</span>
                  )}
                </p>
              )}
              <button
                onClick={() => transition("submit")}
                disabled={saving || status === "SUBMITTED" || blocked}
                title={blocked ? "Resolve the blocking issues first" : undefined}
                className="btn-primary w-full"
              >
                {status === "SUBMITTED" ? "Submitted" : "Submit for review"}
              </button>
            </div>
          )}

          {canReview && (
            <div className="mt-4 space-y-2 border-t border-ink-900/10 pt-3">
              <textarea
                className="input min-h-[54px] resize-y text-xs"
                placeholder="Review note — required to reject; tell the annotator what to fix"
                value={reviewNote}
                onChange={(e) => setReviewNote(e.target.value)}
              />
              <div className="flex gap-2">
                <button
                  onClick={() => transition("approve")}
                  disabled={saving}
                  className="btn-ghost flex-1 border-accent-green/30 text-accent-green hover:border-accent-green/50 hover:bg-accent-green/5"
                >
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

        <div className="text-right text-xs text-ink-400">
          {saving ? "Saving…" : "All changes saved"}
        </div>
      </aside>
      </div>

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-30 -translate-x-1/2 rounded-lg border border-ink-900/15 bg-surface px-4 py-2 text-sm text-ink-900 shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

// Current-frame readout that IS the "go to frame" editor: click to type a
// frame number, Enter seeks, Esc cancels, blur commits.
function FrameReadout({
  currentFrame,
  frameCount,
  onSeek,
}: {
  currentFrame: number;
  frameCount: number; // 0 while unknown
  onSeek: (frame: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const done = useRef(false); // guards blur-after-Enter/Esc double handling

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const commit = () => {
    const n = parseInt(val, 10);
    if (Number.isFinite(n)) {
      onSeek(frameCount > 0 ? Math.max(0, Math.min(n, frameCount - 1)) : Math.max(0, n));
    }
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        value={val}
        onChange={(e) => setVal(e.target.value.replace(/[^\d]/g, ""))}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            done.current = true;
            commit();
          } else if (e.key === "Escape") {
            done.current = true;
            setEditing(false);
          }
        }}
        onBlur={() => {
          if (!done.current) commit();
        }}
        className="w-24 border-b border-accent-blue/60 bg-transparent font-mono text-sm tabular-nums text-ink-900 outline-none"
        aria-label="Go to frame"
      />
    );
  }
  return (
    <button
      onClick={() => {
        done.current = false;
        setVal(String(currentFrame));
        setEditing(true);
      }}
      title="Current frame — click to type a frame number (Enter seeks, Esc cancels)"
      className="font-mono text-sm tabular-nums text-ink-800 transition-colors duration-150 hover:text-ink-900"
    >
      frame <span className="text-accent-blue">{currentFrame}</span>
      {frameCount > 0 && <span className="text-ink-400"> / {frameCount}</span>}
    </button>
  );
}

// One QA checklist line: glyph column + human sentence, with frame ranges and
// measures (12–340, 4.5s, 20f, 120/300f) set in mono tabular figures.
function ChecklistLine({ kind, text }: { kind: "error" | "warn"; text: string }) {
  return (
    <li className="flex gap-2 text-sm leading-snug text-ink-700">
      <span
        className={`w-3 shrink-0 text-center ${
          kind === "error" ? "text-accent-red" : "text-accent-yellow"
        }`}
      >
        {kind === "error" ? "×" : "•"}
      </span>
      <span className="min-w-0">
        <ChecklistText text={text} />
      </span>
    </li>
  );
}

function ChecklistText({ text }: { text: string }) {
  const parts = text.split(/(\d+\/\d+f?|\d+–\d+|\d+(?:\.\d+)?s\b|\d+f\b)/g);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <span key={i} className="font-mono text-xs tabular-nums">
            {p}
          </span>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}
