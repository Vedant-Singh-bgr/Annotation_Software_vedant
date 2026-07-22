"use client";

import { useEffect, useRef, useState } from "react";

// Lightweight preview: plays the clip and shows the live FRAME INDEX (the unit
// the whole guideline uses). The full L1/L2/Q annotation workspace builds on this.
export default function ClipPreview({
  url,
  fps,
  source,
}: {
  url: string;
  fps: number;
  source: "r2" | "direct";
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(0);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const onTime = () => setT(v.currentTime);
    const onMeta = () => setDur(v.duration || 0);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("loadedmetadata", onMeta);
    return () => {
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("loadedmetadata", onMeta);
    };
  }, []);

  const frame = Math.round(t * fps);
  const totalFrames = dur ? Math.round(dur * fps) : null;

  function step(frames: number) {
    const v = ref.current;
    if (!v) return;
    v.currentTime = Math.max(0, v.currentTime + frames / fps);
  }

  return (
    <div>
      <div className="overflow-hidden rounded-lg border border-ink-700 bg-black">
        <video ref={ref} src={url} className="aspect-video w-full bg-black" controls playsInline />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <div className="rounded-md bg-ink-800 px-3 py-1.5 font-mono text-sm text-slate-200">
          frame <span className="text-brand-400">{frame}</span>
          {totalFrames != null ? ` / ${totalFrames}` : ""}
        </div>
        <button className="btn-ghost" onClick={() => step(-1)}>−1 frame</button>
        <button className="btn-ghost" onClick={() => step(1)}>+1 frame</button>
        <span className="text-xs text-slate-500">
          {fps} fps · source: {source === "r2" ? "R2 (presigned)" : "direct URL"}
        </span>
      </div>
    </div>
  );
}
