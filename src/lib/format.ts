/** Format seconds as mm:ss.d (or h:mm:ss.d for long videos). */
export function formatTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const d = Math.floor((sec % 1) * 10);
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  if (h > 0) return `${h}:${mm}:${ss}.${d}`;
  return `${mm}:${ss}.${d}`;
}
