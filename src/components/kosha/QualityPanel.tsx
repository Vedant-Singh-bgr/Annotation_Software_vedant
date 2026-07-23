"use client";

import { useMemo, useState } from "react";
import { FrameQuality } from "./shared";
import { FRAME_QUALITY_FLAGS, sampledFrames } from "@/lib/kosha";

// "real_work" → "Real work"
function humanize(label: string): string {
  const s = label.replace(/_/g, " ");
  return s[0].toUpperCase() + s.slice(1);
}

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
      <p className="py-6 text-center text-sm text-ink-500">
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
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-medium text-ink-900">Frame quality</h3>
        <span className="text-xs tabular-nums text-ink-500">
          {done} of {frames.length} reviewed
        </span>
      </div>

      <p className="text-xs text-ink-500">
        Every {sampleEveryN}th frame is sampled. Judge each flag on the frame itself.
      </p>

      {/* sampled-frame pager — the readout doubles as "seek to this frame" */}
      <div className="flex items-center justify-between">
        <button className="btn-ghost h-7 px-2 text-xs" onClick={() => go(-1)}>
          ← Prev
        </button>
        <button
          onClick={() => onSeek(frame)}
          title="Seek the video to this frame"
          className="group text-center"
        >
          <span className="font-mono text-sm tabular-nums text-ink-900 transition-colors duration-150 group-hover:text-accent-blue">
            frame {frame}
          </span>
          <span className="block text-[11px] text-ink-400">
            {clampedIdx + 1} of {frames.length}
          </span>
        </button>
        <button className="btn-ghost h-7 px-2 text-xs" onClick={() => go(1)}>
          Next →
        </button>
      </div>

      <div className="divide-y divide-ink-900/10 border-t border-ink-900/10">
        {FRAME_QUALITY_FLAGS.map((f) => (
          <label
            key={f.key}
            className="flex cursor-pointer items-center justify-between py-2 text-sm"
          >
            <span className={f.primary ? "font-medium text-ink-900" : "text-ink-700"}>
              {humanize(f.label)}
              {f.primary && (
                <span className="ml-1.5 text-[10px] uppercase tracking-[0.08em] text-ink-400">
                  primary
                </span>
              )}
            </span>
            <input
              type="checkbox"
              disabled={!editable}
              checked={val(f.key)}
              onChange={(e) =>
                onUpsert(frame, { [f.key]: e.target.checked } as Partial<FrameQuality>)
              }
            />
          </label>
        ))}
      </div>

      <p className="text-xs text-ink-400">
        Playhead at frame{" "}
        <span className="font-mono tabular-nums">{currentFrame}</span>
      </p>
    </div>
  );
}
