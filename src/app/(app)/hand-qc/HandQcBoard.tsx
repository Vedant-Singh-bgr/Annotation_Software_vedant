"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import StatusBadge from "@/components/StatusBadge";

type File = {
  id: string;
  title: string;
  reviewStatus: string;
  frameCount: number;
  durationSec: number;
  confirmedPct: number;
  droppedFrames: number;
  reviewerId: string | null;
  reviewerName: string | null;
  batchName: string | null;
};

type Reviewer = { id: string; name: string };
type Batch = { id: string; name: string; fileCount: number };

async function api(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Request failed");
  return data;
}

const FILTERS = ["PENDING", "APPROVED", "REJECTED", "ALL"] as const;

export default function HandQcBoard({
  files,
  status,
  counts,
  isAdmin,
  canAssign,
  reviewers,
  activeBatch,
  batches,
}: {
  files: File[];
  status: string;
  counts: Record<string, number>;
  isAdmin: boolean;
  canAssign: boolean;
  reviewers: Reviewer[];
  activeBatch: string;
  batches: Batch[];
}) {
  const router = useRouter();
  const batchQuery = activeBatch !== "ALL" ? `&batch=${activeBatch}` : "";
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reviewerId, setReviewerId] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const allSelected = files.length > 0 && files.every((f) => selected.has(f.id));

  function toggle(id: string) {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(files.map((f) => f.id)));
  }

  async function assign() {
    if (selected.size === 0 || !reviewerId) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await api("/api/admin/hand-files/assign", "POST", {
        ids: [...selected],
        reviewerId: reviewerId === "__clear__" ? null : reviewerId,
      });
      const who =
        reviewerId === "__clear__"
          ? "unassigned"
          : `assigned to ${reviewers.find((r) => r.id === reviewerId)?.name ?? "reviewer"}`;
      setMsg(`${res.assigned} ${who}.`);
      setSelected(new Set());
      setReviewerId("");
      router.refresh();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-serif text-2xl font-medium text-ink-900">Hand QC</h1>
        <div className="flex items-center gap-2">
          <Link
            href="/hand-qc/local-overlay"
            className="rounded-lg border border-ink-900/15 px-2.5 py-1 text-xs text-ink-600 transition-colors duration-150 hover:border-accent-blue/60 hover:text-ink-900"
          >
            Overlay a local video ↗
          </Link>
          <Link
            href="/hand-qc/local"
            className="rounded-lg border border-ink-900/15 px-2.5 py-1 text-xs text-ink-600 transition-colors duration-150 hover:border-accent-blue/60 hover:text-ink-900"
          >
            Preview a local .npz ↗
          </Link>
        </div>
      </div>
      <p className="mb-5 max-w-2xl text-sm text-ink-500">
        Ground-truth hand-tracking files. Open one to inspect the skeleton (on the
        video when a clip is paired), then approve or reject.
      </p>

      {isAdmin && <ImportPanel batches={batches} />}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f}
            href={`/hand-qc?status=${f}${batchQuery}`}
            className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors duration-150 ${
              status === f
                ? "border-accent-blue/40 bg-accent-blue/10 text-accent-blue"
                : "border-ink-900/15 text-ink-500 hover:border-ink-900/30"
            }`}
          >
            {f.toLowerCase()} ({counts[f] ?? 0})
          </Link>
        ))}
        {batches.length > 0 && (
          <select
            className="input ml-auto h-7 w-56 text-xs"
            value={activeBatch}
            onChange={(e) => router.push(`/hand-qc?status=${status}${e.target.value !== "ALL" ? `&batch=${e.target.value}` : ""}`)}
          >
            <option value="ALL">All batches</option>
            {batches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} ({b.fileCount})
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Assign toolbar — route selected files to a QC reviewer, in batches. */}
      {canAssign && files.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-ink-900/10 bg-paper-50 px-3 py-2 text-sm">
          <label className="flex items-center gap-1.5 text-xs text-ink-600">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleAll}
              className="h-3.5 w-3.5 accent-accent-blue"
            />
            {selected.size > 0 ? `${selected.size} selected` : "Select all"}
          </label>
          <span className="text-ink-300">·</span>
          <select
            className="input h-8 w-48 text-xs"
            value={reviewerId}
            onChange={(e) => setReviewerId(e.target.value)}
          >
            <option value="">Assign to reviewer…</option>
            {reviewers.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
            <option value="__clear__">— Unassign —</option>
          </select>
          <button
            onClick={assign}
            disabled={busy || selected.size === 0 || !reviewerId}
            className="rounded-lg border border-accent-blue/40 bg-accent-blue/5 px-2.5 py-1 text-xs text-accent-blue transition-colors duration-150 hover:bg-accent-blue/10 disabled:opacity-40"
          >
            {busy ? "…" : `Assign (${selected.size})`}
          </button>
          {reviewers.length === 0 && (
            <span className="text-xs text-ink-400">No active QC reviewers to assign to.</span>
          )}
          {msg && <span className="text-xs text-ink-500">{msg}</span>}
        </div>
      )}

      {files.length === 0 ? (
        <div className="card py-12 text-center text-sm text-ink-400">
          No hand files {status === "ALL" ? "yet" : `with status ${status.toLowerCase()}`}.
          {isAdmin ? " Import some from R2 above." : ""}
        </div>
      ) : (
        <ul className="space-y-1">
          {files.map((f) => (
            <li key={f.id} className="flex items-center gap-2">
              {canAssign && (
                <input
                  type="checkbox"
                  checked={selected.has(f.id)}
                  onChange={() => toggle(f.id)}
                  className="h-3.5 w-3.5 shrink-0 accent-accent-blue"
                  aria-label={`Select ${f.title}`}
                />
              )}
              <Link
                href={`/hand-qc/${f.id}`}
                className="flex min-w-0 flex-1 flex-wrap items-center gap-3 rounded-lg border border-ink-900/10 px-3 py-2 text-sm transition-colors duration-150 hover:border-accent-blue/50 hover:bg-ink-900/[0.02]"
              >
                <span className="text-ink-400">✋</span>
                <span className="min-w-0 flex-1 truncate text-ink-800" title={f.title}>
                  {f.title}
                </span>
                {f.batchName && (
                  <span className="shrink-0 rounded-full bg-ink-900/5 px-2 py-0.5 text-[11px] text-ink-500" title="Batch">
                    {f.batchName}
                  </span>
                )}
                {f.reviewerName && (
                  <span className="shrink-0 rounded-full bg-accent-blue/10 px-2 py-0.5 text-[11px] text-accent-blue" title="Routed reviewer">
                    → {f.reviewerName}
                  </span>
                )}
                <span className="shrink-0 font-mono text-xs tabular-nums text-ink-500">
                  {f.frameCount}f · {f.durationSec.toFixed(0)}s
                </span>
                <span
                  className={`shrink-0 text-xs tabular-nums ${
                    f.droppedFrames > 0 ? "text-accent-yellow" : "text-ink-400"
                  }`}
                  title={`${f.droppedFrames} unconfirmed frame·hand slots`}
                >
                  {f.confirmedPct.toFixed(1)}% tracked
                </span>
                <StatusBadge status={f.reviewStatus} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Platform-admin: list .npz in the R2 hands prefix and import selected ones,
// optionally into a batch (existing or newly created).
function ImportPanel({ batches }: { batches: Batch[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [prefix, setPrefix] = useState("");
  const [files, setFiles] = useState<{ key: string; size: number; imported: boolean }[] | null>(null);
  const [folders, setFolders] = useState<string[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<string | null>(null);
  const [batchId, setBatchId] = useState<string>(""); // "" = no batch, "__new__" = create
  const [newBatch, setNewBatch] = useState("");

  const importable = (files ?? []).filter((f) => !f.imported);
  const allPicked = importable.length > 0 && importable.every((f) => picked.has(f.key));

  // List one folder level. `p` defaults to the current prefix; folder clicks pass
  // the target so navigation isn't a step behind the state update.
  async function list(p: string = prefix) {
    setLoading(true);
    setMsg(null);
    try {
      const res = await api(`/api/admin/hand-files${p ? `?prefix=${encodeURIComponent(p)}` : ""}`, "GET");
      if (!res.configured) setMsg("R2 is not configured.");
      setFiles(res.files ?? []);
      setFolders(res.prefixes ?? []);
      setPicked(new Set());
      if (res.truncated) setMsg("Showing the first 1000 entries — narrow with a prefix if needed.");
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function openFolder(p: string) {
    setPrefix(p);
    list(p);
  }
  function goUp() {
    const up = prefix.replace(/[^/]+\/$/, "");
    setPrefix(up);
    list(up);
  }

  function toggleAll() {
    setPicked(allPicked ? new Set() : new Set(importable.map((f) => f.key)));
  }

  async function importPicked() {
    setLoading(true);
    setMsg(null);
    try {
      // Resolve the target batch: create one first if the admin typed a new name.
      let targetBatch: string | null = batchId && batchId !== "__new__" ? batchId : null;
      if (batchId === "__new__" && newBatch.trim()) {
        const created = await api("/api/admin/hand-batches", "POST", { name: newBatch.trim() });
        targetBatch = created.batch.id;
      }
      const res = await api("/api/admin/hand-files", "POST", {
        keys: [...picked],
        batchId: targetBatch,
      });
      setMsg(`${res.imported} imported${res.skipped ? ` · ${res.skipped} skipped` : ""}`);
      setPicked(new Set());
      setNewBatch("");
      await list();
      router.refresh();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mb-4 rounded-lg border border-ink-900/10 bg-paper-50 p-3">
      <button
        onClick={() => {
          setOpen((v) => !v);
          if (!files) list();
        }}
        className="text-sm font-medium text-ink-700"
      >
        Import .npz from R2 {open ? "▾" : "▸"}
      </button>
      {open && (
        <div className="mt-3 space-y-2">
          <div className="flex items-center gap-2">
            <input
              className="input h-8 flex-1 text-xs"
              placeholder="R2 prefix (blank = bucket root)"
              value={prefix}
              onChange={(e) => setPrefix(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && list()}
            />
            <button className="btn-ghost h-8 px-2.5 text-xs" onClick={() => list()} disabled={loading}>
              {loading ? "…" : "List"}
            </button>
          </div>

          {/* Folder browser: current path + subfolders to drill into. */}
          {files && (
            <div className="space-y-0.5">
              <div className="flex items-center gap-2 text-[11px] text-ink-400">
                <span className="font-mono">/{prefix}</span>
                {prefix && (
                  <button onClick={goUp} className="text-accent-blue hover:underline">
                    ⬑ up
                  </button>
                )}
              </div>
              {folders.map((p) => (
                <button
                  key={p}
                  onClick={() => openFolder(p)}
                  className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-xs text-ink-700 hover:bg-ink-900/[0.04]"
                  title={p}
                >
                  <span className="text-ink-400">📁</span>
                  <span className="min-w-0 flex-1 truncate font-mono">{p.slice(prefix.length)}</span>
                </button>
              ))}
            </div>
          )}

          {files && files.length > 0 && (
            <>
              <label className="flex items-center gap-1.5 text-xs text-ink-600">
                <input
                  type="checkbox"
                  checked={allPicked}
                  onChange={toggleAll}
                  disabled={importable.length === 0}
                  className="h-3.5 w-3.5 accent-accent-blue disabled:opacity-25"
                />
                Select all ({importable.length} importable)
              </label>
              <ul className="max-h-52 space-y-0.5 overflow-y-auto">
                {files.map((f) => (
                  <li key={f.key} className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      disabled={f.imported}
                      checked={picked.has(f.key)}
                      onChange={() =>
                        setPicked((prev) => {
                          const n = new Set(prev);
                          if (n.has(f.key)) n.delete(f.key);
                          else n.add(f.key);
                          return n;
                        })
                      }
                      className="h-3.5 w-3.5 accent-accent-blue disabled:opacity-25"
                    />
                    <span className="min-w-0 flex-1 truncate font-mono text-ink-700" title={f.key}>
                      {f.key}
                    </span>
                    {f.imported && <span className="shrink-0 text-ink-400">imported</span>}
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-ink-500">Into batch:</span>
                <select
                  className="input h-8 w-44 text-xs"
                  value={batchId}
                  onChange={(e) => setBatchId(e.target.value)}
                >
                  <option value="">No batch</option>
                  {batches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                  <option value="__new__">+ New batch…</option>
                </select>
                {batchId === "__new__" && (
                  <input
                    className="input h-8 w-40 text-xs"
                    placeholder="New batch name"
                    value={newBatch}
                    onChange={(e) => setNewBatch(e.target.value)}
                  />
                )}
                <button
                  onClick={importPicked}
                  disabled={loading || picked.size === 0 || (batchId === "__new__" && !newBatch.trim())}
                  className="rounded-lg border border-accent-blue/40 bg-accent-blue/5 px-2.5 py-1 text-xs text-accent-blue transition-colors duration-150 hover:bg-accent-blue/10 disabled:opacity-40"
                >
                  {loading ? "Importing…" : `Import (${picked.size})`}
                </button>
              </div>
            </>
          )}
          {files && files.length === 0 && folders.length === 0 && (
            <p className="text-xs text-ink-400">Nothing here — try a different prefix or go up.</p>
          )}
          {msg && <p className="text-xs text-ink-500">{msg}</p>}
        </div>
      )}
    </div>
  );
}
