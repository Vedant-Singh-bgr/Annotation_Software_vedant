"use client";

// Streamed multi-lane timeline (ELAN/Gantt style): every L1 task and L2
// sub-task is always visible as a block across the full clip. Blocks are the
// primary navigation — click to select + seek — and, when editable, support
// pointer-drag to move a whole segment or trim either edge (snapped to frames,
// committed via the existing PATCH endpoints on pointerup).

import { useMemo, useRef, useState } from "react";
import { Task } from "./shared";

type DragMode = "move" | "start" | "end";

type Drag = {
  kind: "task" | "subtask";
  id: string;
  parentId: string | null;
  mode: DragMode;
  origStart: number;
  origEnd: number;
  startX: number;
  pxPerFrame: number;
  // Clamp bounds: value-space for start/end trims, delta-space for moves.
  lo: number;
  hi: number;
  moved: boolean;
  prevStart: number;
  prevEnd: number;
  clientX: number;
  clientY: number;
  // Frames the dragged edge should latch onto: neighbouring block boundaries,
  // the parent's bounds, the playhead. Without these an exact boundary is often
  // literally unreachable — the whole clip is squeezed into ~900px, so one pixel
  // of travel is 8 frames on a 4-minute segment and 30 on a 15-minute one, and
  // the neighbour's frame simply isn't on that lattice.
  snaps: number[];
};

// Latch to the nearest snap target within a few pixels of the cursor, so a drag
// can land on a neighbour's exact boundary instead of straddling it.
//
// The window is measured in PIXELS (a few frames at fine zoom, many at coarse)
// because that is what "looks like the same place" to the annotator, and it must
// be at least half the frames-per-pixel step or exact boundaries stay off the
// reachable lattice entirely. It is then capped at one second, so on a very long
// session — where a pixel can be hundreds of frames — snapping quietly stops
// rather than dragging blocks tens of seconds to a neighbour. At that zoom use
// the numeric field or the ⇥ set-to-playhead button for precision.
function applySnap(
  value: number,
  snaps: number[],
  pxPerFrame: number,
  fps: number,
): number {
  if (snaps.length === 0 || pxPerFrame <= 0) return value;
  const tolerance = Math.min(
    Math.max(1, Math.round(5 / pxPerFrame)),
    Math.max(1, Math.round(fps || 30)),
  );
  let best = value;
  let bestDist = tolerance + 1;
  for (const s of snaps) {
    const d = Math.abs(s - value);
    if (d <= tolerance && d < bestDist) {
      best = s;
      bestDist = d;
    }
  }
  return best;
}

type Props = {
  tasks: Task[];
  frameCount: number; // 0 while unknown
  fps: number;
  currentFrame: number;
  editable: boolean;
  selectedTaskId: string | null;
  selectedSubId: string | null;
  pendingIn: number | null;
  pendingOut: number | null;
  windowRange: [number, number] | null;
  onSeek: (frame: number) => void;
  onSelectTask: (id: string) => void;
  onSelectSub: (taskId: string, subId: string) => void;
  onCommitDrag: (
    kind: "task" | "subtask",
    id: string,
    next: { startFrame: number; endFrame: number },
    mode: DragMode,
  ) => void;
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export default function TimelineBoard({
  tasks,
  frameCount: fc,
  fps,
  currentFrame,
  editable,
  selectedTaskId,
  selectedSubId,
  pendingIn,
  pendingOut,
  windowRange,
  onSeek,
  onSelectTask,
  onSelectSub,
  onCommitDrag,
}: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);

  const pct = (f: number) => (fc > 0 ? (f / fc) * 100 : 0);
  const tc = (f: number) => {
    const s = Math.floor(f / (fps || 30));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };

  // Tick frames at a "nice" seconds step targeting ~7 labels.
  const ticks = useMemo(() => {
    if (fc <= 0) return [] as number[];
    const f = fps || 30;
    const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];
    const target = fc / f / 7;
    const sSec = steps.find((s) => s >= target) ?? 3600;
    const stepF = Math.max(1, Math.round(sSec * f));
    const out: number[] = [];
    for (let x = 0; x <= fc - stepF * 0.5; x += stepF) out.push(x);
    return out;
  }, [fc, fps]);

  if (fc <= 0) {
    return (
      <div className="mt-3 rounded-lg border border-ink-900/10 bg-paper-50 p-4 text-center text-xs text-ink-500">
        Timeline appears once the video duration loads…
      </div>
    );
  }

  // Preview-adjusted span for an entity (applies live drag geometry).
  function spanOf(
    kind: "task" | "subtask",
    id: string,
    start: number,
    end: number,
    parentId?: string,
  ): [number, number] {
    if (!drag) return [start, end];
    if (drag.kind === kind && drag.id === id) return [drag.prevStart, drag.prevEnd];
    // Moving a task carries its sub-tasks along.
    if (kind === "subtask" && drag.kind === "task" && drag.mode === "move" && drag.id === parentId) {
      const d = drag.prevStart - drag.origStart;
      return [start + d, end + d];
    }
    return [start, end];
  }

  function beginDrag(
    e: React.PointerEvent,
    kind: "task" | "subtask",
    entity: { id: string; startFrame: number; endFrame: number },
    mode: DragMode,
    parent: Task | null, // the L1 task: dragged task itself, or a sub's parent
  ) {
    e.stopPropagation();
    // Selection happens on pointerdown so the detail panel opens immediately.
    if (kind === "task") onSelectTask(entity.id);
    else if (parent) onSelectSub(parent.id, entity.id);
    if (!editable) {
      onSeek(entity.startFrame);
      return;
    }
    if (e.button !== 0) return;
    const track = trackRef.current;
    if (!track) return;
    const pxPerFrame = track.getBoundingClientRect().width / fc;

    let lo = 0;
    let hi = 0;
    if (kind === "task") {
      const t = parent!; // the task being dragged
      const subMin = t.subTasks.length
        ? Math.min(...t.subTasks.map((s) => s.startFrame))
        : Number.POSITIVE_INFINITY;
      const subMax = t.subTasks.length
        ? Math.max(...t.subTasks.map((s) => s.endFrame))
        : Number.NEGATIVE_INFINITY;
      if (mode === "start") {
        // Can't trim the start past the first sub-task (containment rule).
        lo = 0;
        hi = Math.min(t.endFrame - 1, subMin);
      } else if (mode === "end") {
        lo = Math.max(t.startFrame + 1, subMax);
        hi = fc;
      } else {
        // Moving shifts sub-tasks along, so only clip bounds constrain it.
        lo = -t.startFrame;
        hi = fc - t.endFrame;
      }
    } else {
      const p = parent!;
      if (mode === "start") {
        lo = p.startFrame;
        hi = entity.endFrame - 1;
      } else if (mode === "end") {
        lo = entity.startFrame + 1;
        hi = p.endFrame;
      } else {
        lo = p.startFrame - entity.startFrame;
        hi = p.endFrame - entity.endFrame;
      }
    }

    // Snap targets: every OTHER block's edges at the same level, the parent's
    // bounds, and the playhead. Excluding this entity's own edges keeps a drag
    // from sticking to where it started.
    const snaps: number[] = [currentFrame];
    if (kind === "task") {
      for (const t of tasks) {
        if (t.id === entity.id) continue;
        snaps.push(t.startFrame, t.endFrame);
      }
      snaps.push(0, fc);
    } else {
      const p = parent!;
      snaps.push(p.startFrame, p.endFrame);
      for (const s of p.subTasks) {
        if (s.id === entity.id) continue;
        snaps.push(s.startFrame, s.endFrame);
      }
    }

    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({
      kind,
      id: entity.id,
      parentId: kind === "subtask" ? (parent?.id ?? null) : null,
      mode,
      snaps,
      origStart: entity.startFrame,
      origEnd: entity.endFrame,
      startX: e.clientX,
      pxPerFrame,
      lo,
      hi,
      moved: false,
      prevStart: entity.startFrame,
      prevEnd: entity.endFrame,
      clientX: e.clientX,
      clientY: e.clientY,
    });
  }

  // Captured pointer events bubble up from the block/handle to the track.
  function onTrackPointerMove(e: React.PointerEvent) {
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const df = drag.pxPerFrame > 0 ? Math.round(dx / drag.pxPerFrame) : 0;
    let s = drag.origStart;
    let en = drag.origEnd;
    if (drag.mode === "move") {
      const d = clamp(df, drag.lo, drag.hi);
      // Snap the leading edge and carry the block with it, so a moved block can
      // sit flush against its neighbour.
      const snappedStart = applySnap(drag.origStart + d, drag.snaps, drag.pxPerFrame, fps);
      const sd = clamp(snappedStart - drag.origStart, drag.lo, drag.hi);
      s += sd;
      en += sd;
    } else if (drag.mode === "start") {
      s = clamp(
        applySnap(drag.origStart + df, drag.snaps, drag.pxPerFrame, fps),
        drag.lo,
        drag.hi,
      );
    } else {
      en = clamp(
        applySnap(drag.origEnd + df, drag.snaps, drag.pxPerFrame, fps),
        drag.lo,
        drag.hi,
      );
    }
    setDrag({
      ...drag,
      prevStart: s,
      prevEnd: en,
      moved: drag.moved || Math.abs(dx) > 3,
      clientX: e.clientX,
      clientY: e.clientY,
    });
  }

  function onTrackPointerUp() {
    if (!drag) return;
    setDrag(null);
    if (!drag.moved) {
      onSeek(drag.origStart); // plain click on a block: seek to its start
      return;
    }
    if (drag.prevStart !== drag.origStart || drag.prevEnd !== drag.origEnd) {
      onCommitDrag(
        drag.kind,
        drag.id,
        { startFrame: drag.prevStart, endFrame: drag.prevEnd },
        drag.mode,
      );
    }
  }

  function onTrackPointerDown(e: React.PointerEvent) {
    // Background click (blocks stopPropagation) — seek, snapped to a frame.
    const rect = e.currentTarget.getBoundingClientRect();
    onSeek(clamp(Math.round(((e.clientX - rect.left) / rect.width) * fc), 0, fc - 1));
  }

  return (
    <div className="mt-3">
      <div className="flex overflow-hidden rounded-lg border border-ink-900/10 bg-paper-50">
        {/* lane labels */}
        <div className="w-24 shrink-0 border-r border-ink-900/10 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-500">
          <div className="flex h-6 items-center border-b border-ink-900/10 px-2">Session</div>
          <div className="flex h-10 items-center border-b border-ink-900/10 px-2">L1 tasks</div>
          <div className="flex h-10 items-center border-b border-ink-900/10 px-2">L2 subs</div>
          <div className="h-5" />
        </div>

        {/* track */}
        <div
          ref={trackRef}
          className="relative min-w-0 flex-1 cursor-pointer touch-none"
          onPointerDown={onTrackPointerDown}
          onPointerMove={onTrackPointerMove}
          onPointerUp={onTrackPointerUp}
          onPointerCancel={() => setDrag(null)}
        >
          {/* tick gridlines through ruler + lanes */}
          {ticks.map((f) => (
            <div
              key={`g${f}`}
              className="pointer-events-none absolute bottom-5 top-0 w-px bg-ink-900/5"
              style={{ left: `${pct(f)}%` }}
            />
          ))}

          {/* ruler: annotation-window indicator */}
          <div className="relative h-6 border-b border-ink-900/10">
            {windowRange && (
              <div
                className="pointer-events-none absolute inset-y-0 border-x border-accent-blue/60 bg-accent-blue/10"
                style={{
                  left: `${pct(windowRange[0])}%`,
                  width: `${Math.max(pct(windowRange[1]) - pct(windowRange[0]), 0.3)}%`,
                }}
                title={`current window ${tc(windowRange[0])}–${tc(windowRange[1])}`}
              />
            )}
          </div>

          {/* L1 task lane */}
          <div className="relative h-10 border-b border-ink-900/10">
            {tasks.length === 0 && (
              <div className="pointer-events-none absolute inset-0 grid place-items-center text-[11px] text-ink-400">
                no tasks yet — position the playhead and click “+ New task”
              </div>
            )}
            {tasks.map((t) => {
              const [s, en] = spanOf("task", t.id, t.startFrame, t.endFrame);
              const sel = selectedTaskId === t.id;
              return (
                <div
                  key={t.id}
                  onPointerDown={(e) => beginDrag(e, "task", t, "move", t)}
                  title={`${t.label || "task"} · f${s}–${en} (${tc(s)}–${tc(en)})`}
                  className={`absolute inset-y-1 rounded-sm border ${
                    sel
                      ? "z-10 border-accent-blue bg-accent-blue/30 shadow-card"
                      : "border-accent-blue/60 bg-accent-blue/20"
                  } ${editable ? "cursor-grab" : ""}`}
                  style={{ left: `${pct(s)}%`, width: `${Math.max(pct(en) - pct(s), 0.4)}%` }}
                >
                  <span className="pointer-events-none absolute inset-x-1.5 top-1/2 -translate-y-1/2 truncate text-[10px] text-ink-800">
                    {t.label || "task"}
                  </span>
                  {editable && (
                    <>
                      <div
                        onPointerDown={(e) => beginDrag(e, "task", t, "start", t)}
                        className="absolute inset-y-0 left-0 w-2 cursor-ew-resize rounded-l-sm hover:bg-accent-blue/40"
                        title="Drag to trim start"
                      />
                      <div
                        onPointerDown={(e) => beginDrag(e, "task", t, "end", t)}
                        className="absolute inset-y-0 right-0 w-2 cursor-ew-resize rounded-r-sm hover:bg-accent-blue/40"
                        title="Drag to trim end"
                      />
                    </>
                  )}
                </div>
              );
            })}
          </div>

          {/* L2 sub-task lane (grouped under parent via a faint blue wash) */}
          <div className="relative h-10 border-b border-ink-900/10">
            {tasks.map((t) => {
              const [ps, pe] = spanOf("task", t.id, t.startFrame, t.endFrame);
              return (
                <div
                  key={`grp-${t.id}`}
                  className={`pointer-events-none absolute inset-y-0 ${
                    selectedTaskId === t.id ? "bg-accent-blue/10" : "bg-accent-blue/5"
                  }`}
                  style={{ left: `${pct(ps)}%`, width: `${Math.max(pct(pe) - pct(ps), 0.4)}%` }}
                />
              );
            })}
            {tasks.flatMap((t) =>
              t.subTasks.map((s) => {
                const [ss, se] = spanOf("subtask", s.id, s.startFrame, s.endFrame, t.id);
                const sel = selectedSubId === s.id;
                const idle = s.label === "idle_wait";
                const cls = sel
                  ? idle
                    ? "z-10 border-accent-yellow bg-accent-yellow/30 shadow-card"
                    : "z-10 border-accent-orange bg-accent-orange/30 shadow-card"
                  : idle
                    ? "border-accent-yellow/60 bg-accent-yellow/15"
                    : "border-accent-orange/60 bg-accent-orange/15";
                return (
                  <div
                    key={s.id}
                    onPointerDown={(e) => beginDrag(e, "subtask", s, "move", t)}
                    title={`${s.label || "sub-task"} · f${ss}–${se} (${tc(ss)}–${tc(se)})`}
                    className={`absolute inset-y-1 rounded-sm border ${cls} ${editable ? "cursor-grab" : ""}`}
                    style={{ left: `${pct(ss)}%`, width: `${Math.max(pct(se) - pct(ss), 0.4)}%` }}
                  >
                    <span className="pointer-events-none absolute inset-x-1.5 top-1/2 -translate-y-1/2 truncate text-[10px] text-ink-800">
                      {s.label || "sub"}
                    </span>
                    {editable && (
                      <>
                        <div
                          onPointerDown={(e) => beginDrag(e, "subtask", s, "start", t)}
                          className="absolute inset-y-0 left-0 w-2 cursor-ew-resize rounded-l-sm hover:bg-accent-orange/40"
                          title="Drag to trim start"
                        />
                        <div
                          onPointerDown={(e) => beginDrag(e, "subtask", s, "end", t)}
                          className="absolute inset-y-0 right-0 w-2 cursor-ew-resize rounded-r-sm hover:bg-accent-orange/40"
                          title="Drag to trim end"
                        />
                      </>
                    )}
                  </div>
                );
              }),
            )}
          </div>

          {/* frame ticks */}
          <div className="relative h-5">
            {ticks.map((f, i) => (
              <span
                key={f}
                title={tc(f)}
                className={`absolute top-0.5 text-xs tabular-nums text-ink-500 ${
                  i === 0 ? "pl-1" : "-translate-x-1/2"
                }`}
                style={{ left: `${pct(f)}%` }}
              >
                {f}
              </span>
            ))}
            <span className="absolute right-1 top-0.5 text-xs tabular-nums text-ink-400">
              {fc}f
            </span>
          </div>

          {/* in/out markers + playhead over ruler + lanes */}
          {pendingIn != null && (
            <div
              className="pointer-events-none absolute bottom-5 top-0 z-20 w-0.5 bg-accent-green"
              style={{ left: `${pct(pendingIn)}%` }}
              title={`In: frame ${pendingIn}`}
            />
          )}
          {pendingOut != null && (
            <div
              className="pointer-events-none absolute bottom-5 top-0 z-20 w-0.5 bg-accent-green/60"
              style={{ left: `${pct(pendingOut)}%` }}
              title={`Out: frame ${pendingOut}`}
            />
          )}
          <div
            className="pointer-events-none absolute bottom-5 top-0 z-20 w-0.5"
            style={{ left: `${pct(currentFrame)}%`, backgroundColor: "rgb(var(--ink-900))" }}
          />
        </div>
      </div>

      {/* legend */}
      <div className="mt-1 flex items-center gap-3 text-[10px] text-ink-400">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2 w-3 rounded-sm border border-accent-blue/60 bg-accent-blue/20" /> L1 task
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2 w-3 rounded-sm border border-accent-orange/60 bg-accent-orange/15" /> L2 sub-task
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2 w-3 rounded-sm border border-accent-yellow/60 bg-accent-yellow/15" /> idle_wait
        </span>
        {editable && (
          <span className="ml-auto">drag a block to move · drag its edges to trim</span>
        )}
      </div>

      {/* live drag readout */}
      {drag?.moved && (
        <div
          className="pointer-events-none fixed z-40 -translate-x-1/2 rounded-md border border-ink-900/15 bg-surface px-2 py-1 font-mono text-xs tabular-nums text-ink-900 shadow-lg"
          style={{ left: drag.clientX, top: drag.clientY - 44 }}
        >
          f {drag.prevStart}–{drag.prevEnd}
          <span className="text-ink-400">
            {" "}
            · {drag.prevEnd - drag.prevStart}f · {tc(drag.prevStart)}–{tc(drag.prevEnd)}
          </span>
        </div>
      )}
    </div>
  );
}
