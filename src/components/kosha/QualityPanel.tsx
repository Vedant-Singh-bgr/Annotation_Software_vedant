"use client";

import { useMemo, useState } from "react";
import { FrameQuality } from "./shared";
import { FRAME_QUALITY_FLAGS, sampledFrames } from "@/lib/kosha";

export default function QualityPanel({
  frameCount,
  sampleEveryN,
  quality,
  editable,
  onUpsert,
  onSeek,
  currentFrame,
}: {
  frameCount: number | null;
  sampleEveryN: number;
  quality: Record<number, FrameQuality>;
  editable: boolean;
  onUpsert: (frameIndex: number, patch: Partial<FrameQuality>) => void;
  onSeek: (frame: number) => void;
  currentFrame: number;
}) {
  const frames = useMemo(
    () => (frameCount ? sampledFrames(frameCount, sampleEveryN) : []),
    [frameCount, sampleEveryN],
  );
  const [idx, setIdx] = useState(0);

  if (!frameCount) {
    return (
      <p className="rounded-md border border-ink-700 p-4 text-center text-xs text-slate-500">
        Waiting for the video duration to load so sampled frames can be computed…
      </p>
    );
  }

  const clampedIdx = Math.min(idx, frames.length - 1);
  const frame = frames[clampedIdx] ?? 0;
  const row = quality[frame];
  const done = frames.filter((f) => quality[f]).length;

  function go(delta: number) {
    const next = Math.max(0, Math.min(frames.length - 1, clampedIdx + delta));
    setIdx(next);
    onSeek(frames[next]);
  }

  function val(key: string): boolean {
    if (row && key in row) return (row as unknown as Record<string, boolean>)[key];
    return key === "realWork"; // default: real_work=yes, rest=no
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">Q Frame quality</h3>
        <span className="text-xs text-slate-500">
          {done}/{frames.length} sampled
        </span>
      </div>

      <p className="text-[11px] text-slate-500">
        Sampling every {sampleEveryN}th frame. Judge each flag on the frame itself.
      </p>

      <div className="flex items-center justify-between rounded-md border border-ink-700 bg-ink-900 px-3 py-2">
        <button className="btn-ghost px-2 py-1 text-xs" onClick={() => go(-1)}>
          ← prev
        </button>
        <div className="text-center">
          <div className="font-mono text-sm text-white">frame {frame}</div>
          <div className="text-[11px] text-slate-500">
            {clampedIdx + 1} / {frames.length}
          </div>
        </div>
        <button className="btn-ghost px-2 py-1 text-xs" onClick={() => go(1)}>
          next →
        </button>
      </div>

      <button
        className="btn-ghost w-full py-1 text-xs"
        onClick={() => onSeek(frame)}
      >
        Seek video to this frame
      </button>

      <div className="space-y-1">
        {FRAME_QUALITY_FLAGS.map((f) => {
          const on = val(f.key);
          return (
            <label
              key={f.key}
              className={`flex cursor-pointer items-center justify-between rounded-md border px-3 py-2 text-sm ${
                f.primary ? "border-brand-600/40 bg-brand-600/5" : "border-ink-700"
              }`}
            >
              <span className={f.primary ? "font-medium text-slate-100" : "text-slate-300"}>
                {f.label}
                {f.primary && (
                  <span className="ml-2 text-[10px] text-slate-500">(primary)</span>
                )}
              </span>
              <input
                type="checkbox"
                disabled={!editable}
                checked={on}
                onChange={(e) => onUpsert(frame, { [f.key]: e.target.checked } as Partial<FrameQuality>)}
              />
            </label>
          );
        })}
      </div>

      <div className="text-[11px] text-slate-500">
        Current playhead: frame {currentFrame}
      </div>
    </div>
  );
}
