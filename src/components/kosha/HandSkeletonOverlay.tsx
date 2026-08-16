"use client";

import { useEffect, useRef } from "react";
import type { ParsedHands } from "@/lib/npz";

// Draws the ground-truth hand skeleton onto the workspace video for the current
// frame. The metric 3D joints (camera frame) are projected with the file's
// pinhole intrinsics — u = fx·X/Z + cx, v = fy·Y/Z + cy — then normalised by the
// calibrated image size and scaled to the video box. Read-only, pointer-events
// none: it never intercepts clicks. Renders nothing without intrinsics (can't
// project) or when the current frame's hand is unconfirmed.
const HAND_COLORS = ["#22d3ee", "#fb923c"]; // [right, left] — matches the 3D viewer

export default function HandSkeletonOverlay({
  hands,
  currentFrame,
}: {
  hands: ParsedHands | null;
  currentFrame: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Latest inputs, read by the resize callback without re-subscribing per frame.
  const latest = useRef({ hands, currentFrame });
  latest.current = { hands, currentFrame };

  // Redraw whenever the box resizes (crisp at devicePixelRatio, projection
  // rescaled to the new size). Subscribed once.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() =>
      draw(canvas, latest.current.hands, latest.current.currentFrame),
    );
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  // Redraw on every frame / data change.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) draw(canvas, hands, currentFrame);
  }, [hands, currentFrame]);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0 h-full w-full"
    />
  );
}

function draw(canvas: HTMLCanvasElement, hands: ParsedHands | null, frame: number) {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const W = Math.max(1, Math.round(rect.width * dpr));
  const H = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== W) canvas.width = W;
  if (canvas.height !== H) canvas.height = H;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, W, H);
  if (!hands || !hands.intrinsics) return;

  const { fx, fy, cx, cy, imgW, imgH } = hands.intrinsics;
  const { handCount, jointCount, confirmed, joints, edges } = hands;
  if (frame < 0 || frame >= hands.frameCount) return;

  // Source-pixel -> canvas: normalise by the calibrated image, scale to the box
  // (object-fit: fill on the <video>, so the same normalised mapping aligns).
  const sx = W / imgW;
  const sy = H / imgH;
  const r = Math.max(2, 3 * dpr);

  for (let h = 0; h < handCount; h++) {
    if (!confirmed[frame * handCount + h]) continue;
    const color = HAND_COLORS[h % HAND_COLORS.length];
    const base = (frame * handCount + h) * jointCount * 3;

    // Project the 21 joints to canvas pixels (null where behind the camera).
    const pts: Array<[number, number] | null> = [];
    for (let j = 0; j < jointCount; j++) {
      const o = base + j * 3;
      const X = joints[o], Y = joints[o + 1], Z = joints[o + 2];
      if (!(Z > 0) || Number.isNaN(X)) {
        pts.push(null);
        continue;
      }
      pts.push([(fx * X / Z + cx) * sx, (fy * Y / Z + cy) * sy]);
    }

    // Bones.
    ctx.lineWidth = Math.max(1.5, 2 * dpr);
    ctx.strokeStyle = color;
    ctx.beginPath();
    for (let e = 0; e < edges.length; e += 2) {
      const a = pts[edges[e]];
      const b = pts[edges[e + 1]];
      if (!a || !b) continue;
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
    }
    ctx.stroke();

    // Joints.
    ctx.fillStyle = color;
    for (const p of pts) {
      if (!p) continue;
      ctx.beginPath();
      ctx.arc(p[0], p[1], r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
