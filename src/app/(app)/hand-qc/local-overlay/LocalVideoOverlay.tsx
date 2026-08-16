"use client";

import { useEffect, useRef, useState } from "react";
import { parseHandNpz, type ParsedHands } from "@/lib/npz";
import HandSkeletonOverlay from "@/components/kosha/HandSkeletonOverlay";

// Drop an .mp4 + its hand-tracking .npz straight from your computer and see the
// skeleton projected onto the video — no upload, no R2. Uses the exact overlay
// the annotation workspace uses, so what you see here is what annotators see.
// Purely a local sanity-check of alignment / frame-sync.
export default function LocalVideoOverlay() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoName, setVideoName] = useState<string>("");
  const [hands, setHands] = useState<ParsedHands | null>(null);
  const [npzName, setNpzName] = useState<string>("");
  const [currentFrame, setCurrentFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const fps = hands?.fps || 30;
  const frameCount = hands?.frameCount ?? 0;

  // Free the object URL when it's replaced / unmounted.
  useEffect(() => {
    return () => {
      if (videoUrl) URL.revokeObjectURL(videoUrl);
    };
  }, [videoUrl]);

  // Follow the video: a rAF loop maps currentTime → frame index so the overlay
  // stays synced while playing and scrubbing.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    let raf = 0;
    const tick = () => {
      const f = Math.round(v.currentTime * fps);
      setCurrentFrame((prev) => (prev === f ? prev : f));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [videoUrl, fps]);

  function onVideo(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setVideoUrl(URL.createObjectURL(f));
    setVideoName(f.name);
    setCurrentFrame(0);
  }

  async function onNpz(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setErr(null);
    try {
      const buf = new Uint8Array(await f.arrayBuffer());
      setHands(parseHandNpz(buf));
      setNpzName(f.name);
    } catch (e2) {
      setErr((e2 as Error).message);
      setHands(null);
      setNpzName("");
    }
  }

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      v.play();
      setPlaying(true);
    } else {
      v.pause();
      setPlaying(false);
    }
  }

  function seek(frame: number) {
    const v = videoRef.current;
    if (!v) return;
    const clamped = Math.max(0, frameCount ? Math.min(frameCount - 1, frame) : frame);
    v.currentTime = clamped / fps + 0.0001;
    setCurrentFrame(clamped);
  }

  const noIntrinsics = hands && !hands.intrinsics;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
      <div>
        <div className="relative overflow-hidden rounded-lg border border-ink-900/10 bg-black">
          {videoUrl ? (
            <video
              ref={videoRef}
              src={videoUrl}
              className="block w-full bg-black"
              onClick={togglePlay}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              playsInline
              preload="auto"
            />
          ) : (
            <div className="flex aspect-video items-center justify-center text-sm text-ink-500">
              Pick an .mp4 to begin →
            </div>
          )}
          {videoUrl && hands && hands.intrinsics && (
            <HandSkeletonOverlay hands={hands} currentFrame={currentFrame} />
          )}
          <div className="pointer-events-none absolute left-3 top-2 font-mono text-sm text-white [text-shadow:0_1px_3px_#000]">
            frame {currentFrame}
            {frameCount ? ` / ${frameCount - 1}` : ""}
          </div>
        </div>

        {/* transport */}
        {videoUrl && (
          <div className="mt-2 flex items-center gap-3">
            <button onClick={togglePlay} className="btn-ghost h-9 w-12 text-sm">
              {playing ? "❚❚" : "▶"}
            </button>
            {[-10, -1, 1, 10].map((d) => (
              <button
                key={d}
                onClick={() => seek(currentFrame + d)}
                className="btn-ghost h-9 px-2 text-xs tabular-nums"
              >
                {d > 0 ? `+${d}` : d}
              </button>
            ))}
            {frameCount > 0 && (
              <input
                type="range"
                min={0}
                max={frameCount - 1}
                value={Math.min(currentFrame, frameCount - 1)}
                onChange={(e) => seek(Number(e.target.value))}
                className="h-1 flex-1 accent-accent-blue"
              />
            )}
          </div>
        )}
      </div>

      <div className="space-y-3">
        <div className="card space-y-2 p-3">
          <label className="btn-primary block cursor-pointer text-center text-sm">
            {videoName ? "Choose another .mp4" : "Choose an .mp4"}
            <input type="file" accept="video/mp4,.mp4" className="hidden" onChange={onVideo} />
          </label>
          <label className="btn-ghost block cursor-pointer text-center text-sm">
            {npzName ? "Choose another .npz" : "Choose the .npz"}
            <input type="file" accept=".npz" className="hidden" onChange={onNpz} />
          </label>
        </div>

        {(videoName || npzName) && (
          <div className="card space-y-1.5 p-3 text-sm">
            <Row label="Video" value={videoName || "—"} />
            <Row label="Hands" value={npzName || "—"} />
            {hands && (
              <>
                <Row label="Frames" value={`${hands.frameCount} @ ${hands.fps}fps`} />
                <Row label="Tracked" value={`${hands.confirmedPct.toFixed(1)}%`} warn={hands.confirmedPct < 100} />
                <Row
                  label="Intrinsics"
                  value={hands.intrinsics ? `${hands.intrinsics.imgW}×${hands.intrinsics.imgH}` : "missing"}
                  warn={!hands.intrinsics}
                />
              </>
            )}
          </div>
        )}

        {noIntrinsics && (
          <p className="text-xs text-accent-yellow">
            This .npz has no camera intrinsics, so it can&apos;t be projected onto the
            video (3D-only file).
          </p>
        )}
        {err && <p className="text-xs text-accent-red">Couldn&apos;t read the .npz: {err}</p>}

        <p className="text-[11px] text-ink-400">
          Both files stay on your machine — parsed and rendered in the browser. This
          is the same overlay the workspace draws; use it to check a clip&apos;s hands
          line up before staging to R2.
        </p>
      </div>
    </div>
  );
}

function Row({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="shrink-0 text-ink-500">{label}</span>
      <span className={`min-w-0 truncate text-right font-mono text-xs tabular-nums ${warn ? "text-accent-yellow" : "text-ink-700"}`}>
        {value}
      </span>
    </div>
  );
}
