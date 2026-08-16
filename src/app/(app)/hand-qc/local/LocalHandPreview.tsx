"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { parseHandNpz } from "@/lib/npz";
import HandSkeletonCanvas, { HandsData } from "../HandSkeletonCanvas";

// Load a .npz straight from the user's computer and render it — parsed in the
// browser (fflate), so the preview never leaves the machine. Platform admins can
// then "Add to QC queue", which uploads it and creates a HandFile you can
// approve/reject; the R2-prefix import is the other way files enter.
export default function LocalHandPreview({ isAdmin }: { isAdmin: boolean }) {
  const router = useRouter();
  const [hands, setHands] = useState<HandsData | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [meta, setMeta] = useState<{
    name: string;
    frameCount: number;
    fps: number;
    confirmedPct: number;
    droppedFrames: number;
  } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setBusy(true);
    setErr(null);
    setUploadMsg(null);
    try {
      const buf = new Uint8Array(await f.arrayBuffer());
      const p = parseHandNpz(buf);
      setHands({
        frameCount: p.frameCount,
        handCount: p.handCount,
        jointCount: p.jointCount,
        fps: p.fps,
        edges: p.edges,
        confirmed: p.confirmed,
        joints: p.joints,
      });
      setMeta({
        name: f.name,
        frameCount: p.frameCount,
        fps: p.fps,
        confirmedPct: p.confirmedPct,
        droppedFrames: p.droppedFrames,
      });
      setFile(f);
    } catch (e2) {
      setErr((e2 as Error).message);
      setHands(null);
      setMeta(null);
      setFile(null);
    } finally {
      setBusy(false);
    }
  }

  async function addToQueue() {
    if (!file) return;
    setUploading(true);
    setUploadMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/admin/hand-files/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      router.push(`/hand-qc/${data.id}`);
    } catch (e) {
      setUploadMsg((e as Error).message);
      setUploading(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <div>
        <HandSkeletonCanvas hands={hands} />
        {!hands && !err && (
          <p className="mt-3 text-sm text-ink-400">
            Pick a hand-tracking <code>.npz</code> to preview it here. Nothing is
            uploaded — it&apos;s parsed and rendered in your browser.
          </p>
        )}
        {err && <p className="mt-2 text-sm text-accent-red">Couldn&apos;t read that file: {err}</p>}
      </div>

      <div className="space-y-4">
        <div className="card p-3">
          <label className="btn-primary block cursor-pointer text-center text-sm">
            {busy ? "Reading…" : hands ? "Choose another .npz" : "Choose a .npz from your computer"}
            <input type="file" accept=".npz" className="hidden" onChange={onFile} disabled={busy} />
          </label>
        </div>

        {meta && (
          <div className="card space-y-1.5 p-3 text-sm">
            <Row label="File" value={meta.name} />
            <Row label="Frames" value={`${meta.frameCount} · ${(meta.frameCount / (meta.fps || 30)).toFixed(0)}s @ ${meta.fps}fps`} />
            <Row label="Tracked" value={`${meta.confirmedPct.toFixed(1)}%`} warn={meta.confirmedPct < 100} />
            <Row label="Dropped slots" value={String(meta.droppedFrames)} warn={meta.droppedFrames > 0} />
          </div>
        )}

        {hands && isAdmin && (
          <div className="space-y-1.5">
            <button
              onClick={addToQueue}
              disabled={uploading}
              className="w-full rounded-lg border border-accent-blue/40 bg-accent-blue/5 py-2 text-sm text-accent-blue transition-colors duration-150 hover:bg-accent-blue/10 disabled:opacity-40"
            >
              {uploading ? "Uploading…" : "Add to QC queue →"}
            </button>
            <p className="text-[11px] text-ink-400">
              Uploads the file and creates a reviewable record so you can approve /
              reject it. The preview above stays local until you do.
            </p>
            {uploadMsg && <p className="text-xs text-accent-red">{uploadMsg}</p>}
          </div>
        )}
        {hands && !isAdmin && (
          <p className="text-[11px] text-ink-400">
            Preview only. Ask a platform admin to add this file to the QC queue.
          </p>
        )}
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
