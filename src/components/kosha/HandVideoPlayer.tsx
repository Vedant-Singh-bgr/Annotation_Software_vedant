"use client";

import { useEffect, useRef, useState } from "react";
import type { ParsedHands } from "@/lib/npz";
import HandSkeletonOverlay from "./HandSkeletonOverlay";

// Video with the hand skeleton projected on top, plus play/scrub transport.
// Presentational: given a video URL and parsed hands, it keeps the overlay
// synced to the current frame. Shared by the Hand QC review page and the local
// overlay test page.
export default function HandVideoPlayer({
  videoUrl,
  hands,
}: {
  videoUrl: string;
  hands: ParsedHands;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const fps = hands.fps || 30;
  const frameCount = hands.frameCount;

  // Follow the video: map currentTime → frame so the overlay stays synced.
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
  }, [fps]);

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play();
    else v.pause();
  }

  function seek(frame: number) {
    const v = videoRef.current;
    if (!v) return;
    const clamped = Math.max(0, frameCount ? Math.min(frameCount - 1, frame) : frame);
    v.currentTime = clamped / fps + 0.0001;
    setCurrentFrame(clamped);
  }

  return (
    <div>
      <div className="relative overflow-hidden rounded-lg border border-ink-900/10 bg-black">
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
        {hands.intrinsics && <HandSkeletonOverlay hands={hands} currentFrame={currentFrame} />}
        <div className="pointer-events-none absolute left-3 top-2 font-mono text-sm text-white [text-shadow:0_1px_3px_#000]">
          frame {currentFrame}
          {frameCount ? ` / ${frameCount - 1}` : ""}
        </div>
      </div>

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
      {!hands.intrinsics && (
        <p className="mt-2 text-xs text-accent-yellow">
          This hand file has no camera intrinsics, so the skeleton can&apos;t be
          projected onto the video.
        </p>
      )}
    </div>
  );
}
