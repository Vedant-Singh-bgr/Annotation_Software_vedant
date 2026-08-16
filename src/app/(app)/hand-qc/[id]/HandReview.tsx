"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import HandSkeletonCanvas, { HandsData } from "../HandSkeletonCanvas";

// Unpack the compact viewer binary written by packViewer() in src/lib/npz.ts.
function unpackViewer(buf: ArrayBuffer): HandsData {
  const dv = new DataView(buf);
  let o = 0;
  const frameCount = dv.getUint32(o, true); o += 4;
  const handCount = dv.getUint32(o, true); o += 4;
  const jointCount = dv.getUint32(o, true); o += 4;
  const edgeCount = dv.getUint32(o, true); o += 4;
  const fps = dv.getFloat32(o, true); o += 4;
  const edges = new Uint16Array(buf.slice(o, o + edgeCount * 2 * 2)); o += edgeCount * 2 * 2;
  const confirmed = new Uint8Array(buf.slice(o, o + frameCount * handCount)); o += frameCount * handCount;
  const joints = new Float32Array(buf.slice(o));
  return { frameCount, handCount, jointCount, fps, edges, confirmed, joints };
}

type Meta = {
  fps: number;
  frameCount: number;
  handCount: number;
  confirmedPct: number;
  droppedFrames: number;
  reviewStatus: string;
  reviewNote: string;
};

export default function HandReview({ id }: { id: string }) {
  const router = useRouter();
  const [hands, setHands] = useState<HandsData | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const info = await fetch(`/api/hand-files/${id}/viewer`).then((r) => r.json());
        if (!info || info.error) throw new Error(info?.error ?? "Failed to load");
        if (cancelled) return;
        setMeta(info);
        setNote(info.reviewNote ?? "");
        const buf = await fetch(info.url).then((r) => r.arrayBuffer());
        if (cancelled) return;
        setHands(unpackViewer(buf));
      } catch (e) {
        if (!cancelled) setLoadErr((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function review(action: "approve" | "reject") {
    setBusy(true);
    setActionMsg(null);
    try {
      const res = await fetch(`/api/hand-files/${id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reviewNote: note }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setMeta((m) => (m ? { ...m, reviewStatus: data.handFile.reviewStatus } : m));
      setActionMsg(`Marked ${data.handFile.reviewStatus.toLowerCase()}`);
      router.refresh();
    } catch (e) {
      setActionMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <div>
        <HandSkeletonCanvas hands={hands} />
        {loadErr && <p className="mt-2 text-sm text-accent-red">{loadErr}</p>}
      </div>

      <div className="space-y-4">
        {meta && (
          <>
            <div className="card space-y-1.5 p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-ink-500">Status</span>
                <span
                  className={
                    meta.reviewStatus === "APPROVED"
                      ? "text-accent-green"
                      : meta.reviewStatus === "REJECTED"
                        ? "text-accent-red"
                        : "text-ink-700"
                  }
                >
                  {meta.reviewStatus.toLowerCase()}
                </span>
              </div>
              <Row label="Frames" value={`${meta.frameCount} · ${(meta.frameCount / (meta.fps || 30)).toFixed(0)}s @ ${meta.fps}fps`} />
              <Row label="Hands" value={String(meta.handCount)} />
              <Row label="Tracked" value={`${meta.confirmedPct.toFixed(1)}%`} warn={meta.confirmedPct < 100} />
              <Row label="Dropped slots" value={String(meta.droppedFrames)} warn={meta.droppedFrames > 0} />
            </div>

            <div>
              <div className="label">Review note</div>
              <textarea
                className="input resize-y"
                rows={3}
                value={note}
                placeholder="Why approve / reject…"
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => review("approve")}
                disabled={busy}
                className="flex-1 rounded-lg border border-accent-green/40 bg-accent-green/5 py-2 text-sm text-accent-green transition-colors duration-150 hover:bg-accent-green/10 disabled:opacity-40"
              >
                Approve
              </button>
              <button
                onClick={() => review("reject")}
                disabled={busy}
                className="flex-1 rounded-lg border border-accent-red/40 bg-accent-red/5 py-2 text-sm text-accent-red transition-colors duration-150 hover:bg-accent-red/10 disabled:opacity-40"
              >
                Reject
              </button>
            </div>
            {actionMsg && <p className="text-xs text-ink-500">{actionMsg}</p>}
          </>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-ink-500">{label}</span>
      <span className={`font-mono text-xs tabular-nums ${warn ? "text-accent-yellow" : "text-ink-700"}`}>
        {value}
      </span>
    </div>
  );
}
