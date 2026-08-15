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
};

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
}: {
  files: File[];
  status: string;
  counts: Record<string, number>;
  isAdmin: boolean;
}) {
  return (
    <div>
      <h1 className="mb-1 font-serif text-2xl font-medium text-ink-900">Hand QC</h1>
      <p className="mb-5 max-w-2xl text-sm text-ink-500">
        Ground-truth hand-tracking files. Open one to inspect the 3D skeleton, then
        approve or reject.
      </p>

      {isAdmin && <ImportPanel />}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f}
            href={`/hand-qc?status=${f}`}
            className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors duration-150 ${
              status === f
                ? "border-accent-blue/40 bg-accent-blue/10 text-accent-blue"
                : "border-ink-900/15 text-ink-500 hover:border-ink-900/30"
            }`}
          >
            {f.toLowerCase()} ({counts[f] ?? 0})
          </Link>
        ))}
      </div>

      {files.length === 0 ? (
        <div className="card py-12 text-center text-sm text-ink-400">
          No hand files {status === "ALL" ? "yet" : `with status ${status.toLowerCase()}`}.
          {isAdmin ? " Import some from R2 above." : ""}
        </div>
      ) : (
        <ul className="space-y-1">
          {files.map((f) => (
            <li key={f.id}>
              <Link
                href={`/hand-qc/${f.id}`}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-ink-900/10 px-3 py-2 text-sm transition-colors duration-150 hover:border-accent-blue/50 hover:bg-ink-900/[0.02]"
              >
                <span className="text-ink-400">✋</span>
                <span className="min-w-0 flex-1 truncate text-ink-800" title={f.title}>
                  {f.title}
                </span>
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

// Platform-admin: list .npz in the R2 hands prefix and import selected ones.
function ImportPanel() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [prefix, setPrefix] = useState("");
  const [files, setFiles] = useState<{ key: string; size: number; imported: boolean }[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<string | null>(null);

  async function list() {
    setLoading(true);
    setMsg(null);
    try {
      const res = await api(`/api/admin/hand-files${prefix ? `?prefix=${encodeURIComponent(prefix)}` : ""}`, "GET");
      if (!res.configured) setMsg("R2 is not configured.");
      setFiles(res.files ?? []);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function importPicked() {
    setLoading(true);
    setMsg(null);
    try {
      const res = await api("/api/admin/hand-files", "POST", { keys: [...picked] });
      setMsg(`${res.imported} imported${res.skipped ? ` · ${res.skipped} skipped` : ""}`);
      setPicked(new Set());
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
              placeholder="R2 prefix (default hands/)"
              value={prefix}
              onChange={(e) => setPrefix(e.target.value)}
            />
            <button className="btn-ghost h-8 px-2.5 text-xs" onClick={list} disabled={loading}>
              {loading ? "…" : "List"}
            </button>
          </div>
          {files && files.length > 0 && (
            <>
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
              <button
                onClick={importPicked}
                disabled={loading || picked.size === 0}
                className="rounded-lg border border-accent-blue/40 bg-accent-blue/5 px-2.5 py-1 text-xs text-accent-blue transition-colors duration-150 hover:bg-accent-blue/10 disabled:opacity-40"
              >
                {loading ? "Importing…" : `Import (${picked.size})`}
              </button>
            </>
          )}
          {files && files.length === 0 && (
            <p className="text-xs text-ink-400">No .npz found under that prefix.</p>
          )}
          {msg && <p className="text-xs text-ink-500">{msg}</p>}
        </div>
      )}
    </div>
  );
}
