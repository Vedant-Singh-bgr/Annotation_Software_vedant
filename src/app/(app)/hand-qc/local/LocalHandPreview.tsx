"use client";

import { useState } from "react";
import { parseHandNpz } from "@/lib/npz";
import HandSkeletonCanvas, { HandsData } from "../HandSkeletonCanvas";

type Meta = {
  name: string;
  frameCount: number;
  handCount: number;
  fps: number;
  confirmedPct: number;
  droppedFrames: number;
};

// Load a .npz straight from the user's computer and render it — parsed in the
// browser (fflate), so the preview never leaves the machine. Platform admins can
// then "Add to QC queue" (uploads it and creates a HandFile), review it —
// approve/reject + note — and export the QC record, all on this page. The
// R2-prefix import is the other way files enter.
export default function LocalHandPreview({ isAdmin }: { isAdmin: boolean }) {
  const [hands, setHands] = useState<HandsData | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Set once the file is persisted, unlocking review + export.
  const [savedId, setSavedId] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("PENDING");
  const [note, setNote] = useState("");
  const [uploading, setUploading] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);

  function reset() {
    setSavedId(null);
    setStatus("PENDING");
    setNote("");
    setUploadMsg(null);
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setBusy(true);
    setErr(null);
    reset();
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
        handCount: p.handCount,
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
      setSavedId(data.id);
      setUploadMsg(data.alreadyExisted ? "Already in the queue — loaded its record." : "Added to the QC queue.");
    } catch (e) {
      setUploadMsg((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function review(action: "approve" | "reject") {
    if (!savedId) return;
    setReviewing(true);
    setUploadMsg(null);
    try {
      const res = await fetch(`/api/hand-files/${savedId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reviewNote: note }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setStatus(data.handFile.reviewStatus);
      setUploadMsg(
        data.export?.key
          ? "Saved — verdict delivered to R2 beside the .npz."
          : data.exportError
            ? `Saved — R2 delivery failed: ${data.exportError}`
            : "Saved.",
      );
    } catch (e) {
      setUploadMsg((e as Error).message);
    } finally {
      setReviewing(false);
    }
  }

  function exportReport() {
    if (!meta) return;
    const report = {
      handFileId: savedId,
      file: meta.name,
      frameCount: meta.frameCount,
      handCount: meta.handCount,
      fps: meta.fps,
      durationSec: meta.frameCount / (meta.fps || 30),
      confirmedPct: meta.confirmedPct,
      droppedSlots: meta.droppedFrames,
      reviewStatus: status,
      reviewNote: note,
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${meta.name.replace(/\.npz$/i, "")}.qc.json`;
    a.click();
    URL.revokeObjectURL(url);
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
            {savedId && (
              <div className="flex items-center justify-between pt-0.5">
                <span className="text-ink-500">Status</span>
                <span
                  className={
                    status === "APPROVED"
                      ? "text-accent-green"
                      : status === "REJECTED"
                        ? "text-accent-red"
                        : "text-ink-700"
                  }
                >
                  {status.toLowerCase()}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Not persisted yet — admins upload to unlock review + export. */}
        {hands && isAdmin && !savedId && (
          <div className="space-y-1.5">
            <button
              onClick={addToQueue}
              disabled={uploading}
              className="w-full rounded-lg border border-accent-blue/40 bg-accent-blue/5 py-2 text-sm text-accent-blue transition-colors duration-150 hover:bg-accent-blue/10 disabled:opacity-40"
            >
              {uploading ? "Uploading…" : "Add to QC queue →"}
            </button>
            <p className="text-[11px] text-ink-400">
              Uploads the file and creates a reviewable record. Then approve /
              reject and export it right here — no need to leave the page.
            </p>
            {uploadMsg && <p className="text-xs text-accent-red">{uploadMsg}</p>}
          </div>
        )}

        {/* Persisted — review + export inline. */}
        {savedId && (
          <>
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
                disabled={reviewing}
                className="flex-1 rounded-lg border border-accent-green/40 bg-accent-green/5 py-2 text-sm text-accent-green transition-colors duration-150 hover:bg-accent-green/10 disabled:opacity-40"
              >
                Approve
              </button>
              <button
                onClick={() => review("reject")}
                disabled={reviewing}
                className="flex-1 rounded-lg border border-accent-red/40 bg-accent-red/5 py-2 text-sm text-accent-red transition-colors duration-150 hover:bg-accent-red/10 disabled:opacity-40"
              >
                Reject
              </button>
            </div>
            <button
              onClick={exportReport}
              className="w-full rounded-lg border border-ink-900/15 py-2 text-sm text-ink-600 transition-colors duration-150 hover:border-ink-900/30 hover:text-ink-900"
            >
              Export QC record (JSON) ↓
            </button>
            {uploadMsg && <p className="text-xs text-ink-500">{uploadMsg}</p>}
          </>
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
