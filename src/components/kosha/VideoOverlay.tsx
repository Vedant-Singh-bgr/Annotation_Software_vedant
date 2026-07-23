"use client";

import { useMemo } from "react";
import { Task, FrameQuality } from "./shared";
import { FRAME_QUALITY_FLAGS } from "@/lib/kosha";

// Live label HUD drawn on top of the workspace video. Unlike the standalone
// overlay.html (which reads the saved DB export), this is fed by the workspace's
// in-memory state — so it reflects the annotator's unsaved edits in real time,
// updating as they scrub. Read-only and pointer-events-none: purely a visual
// confirmation layer that never intercepts clicks on the video.
export default function VideoOverlay({
  tasks,
  quality,
  currentFrame,
}: {
  tasks: Task[];
  quality: Record<number, FrameQuality>;
  currentFrame: number;
}) {
  const l1 = useMemo(
    () => tasks.find((t) => currentFrame >= t.startFrame && currentFrame < t.endFrame) ?? null,
    [tasks, currentFrame],
  );
  const l2 = useMemo(() => {
    for (const t of tasks) {
      const s = t.subTasks.find(
        (s) => currentFrame >= s.startFrame && currentFrame < s.endFrame,
      );
      if (s) return s;
    }
    return null;
  }, [tasks, currentFrame]);

  // Nearest sampled Q row at or before the current frame.
  const q = useMemo(() => {
    const frames = Object.keys(quality)
      .map(Number)
      .filter((f) => f <= currentFrame)
      .sort((a, b) => b - a);
    return frames.length ? quality[frames[0]] : null;
  }, [quality, currentFrame]);

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 p-3 font-mono text-[13px] [text-shadow:0_1px_3px_#000]">
      <div className="text-lg font-bold text-brand-300">frame {currentFrame}</div>

      <div className="mt-1 text-white">
        {l1 ? (
          <>
            ▶ <b>{l1.label || "(unlabeled)"}</b>{" "}
            <span className="text-[11px] text-slate-300">
              {[l1.difficulty, l1.venueL2, l1.venueL3, l1.job].filter(Boolean).join(" · ")}
              {" "}[{l1.startFrame}–{l1.endFrame}]
            </span>
          </>
        ) : (
          <span className="text-slate-400">— no L1 task at this frame (gap) —</span>
        )}
      </div>

      <div className="mt-0.5 text-amber-200">
        {l2 ? (
          <>
            • <b>{l2.label || "(unlabeled)"}</b>{" "}
            <span className="text-[11px] text-slate-200">
              L:{l2.objectLeft || "–"} R:{l2.objectRight || "–"}
            </span>
          </>
        ) : l1 ? (
          <span className="text-slate-400">• no sub-task here (gap in tiling)</span>
        ) : null}
      </div>

      {q && (
        <div className="mt-2 inline-block rounded bg-black/50 px-2 py-1 text-[11px]">
          Q@{q.frameIndex}{" "}
          {FRAME_QUALITY_FLAGS.map((f) => {
            const on = (q as unknown as Record<string, boolean>)[f.key];
            return (
              <span key={f.key} className={on ? "font-bold text-red-400" : "text-slate-500"}>
                {" "}
                {f.label}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
