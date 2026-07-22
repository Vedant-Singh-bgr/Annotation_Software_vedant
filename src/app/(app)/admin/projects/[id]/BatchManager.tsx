"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { DEFAULT_FPS, DEFAULT_SAMPLE_EVERY_N } from "@/lib/kosha";

type Clip = {
  id: string;
  title: string;
  r2Key: string | null;
  sourceUrl: string | null;
  sizeBytes: number | null;
  fps: number;
  assignmentCount: number;
  sessionId: string | null;
  dataType: string | null;
  proxyStatus: string;
  proxyError: string | null;
  frameCount: number | null;
  segmentCount: number;
  assignments: { id: string; status: string; annotator: string }[];
};
type Batch = {
  id: string;
  name: string;
  r2Prefix: string;
  sampleEveryN: number;
  defaultFps: number;
  manifestR2Key: string | null;
  publishedAt: string | null;
  approvedCount: number;
  clips: Clip[];
};
type Project = { id: string; name: string; org: string; batches: Batch[] };

function fmtBytes(n: number | null): string {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

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

export default function BatchManager({
  project,
  r2Configured,
}: {
  project: Project;
  r2Configured: boolean;
}) {
  const router = useRouter();
  const [showNew, setShowNew] = useState(project.batches.length === 0);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-white">
          {project.name}{" "}
          <span className="text-sm font-normal text-slate-500">
            · {project.batches.length} batches
          </span>
        </h1>
        <button className="btn-primary" onClick={() => setShowNew((v) => !v)}>
          {showNew ? "Close" : "+ New batch"}
        </button>
      </div>

      {!r2Configured && (
        <p className="mb-4 rounded-md border border-amber-800/50 bg-amber-950/30 px-3 py-2 text-xs text-amber-300">
          R2 credentials are not configured, so live bucket browsing is disabled.
          You can still add clips manually by key/URL. Set R2_* env vars to enable
          “Import from R2”.
        </p>
      )}

      {showNew && (
        <NewBatchForm
          projectId={project.id}
          onDone={() => {
            setShowNew(false);
            router.refresh();
          }}
        />
      )}

      <div className="mt-4 space-y-4">
        {project.batches.map((b) => (
          <BatchCard
            key={b.id}
            batch={b}
            r2Configured={r2Configured}
            onChange={() => router.refresh()}
          />
        ))}
      </div>
    </div>
  );
}

function NewBatchForm({
  projectId,
  onDone,
}: {
  projectId: string;
  onDone: () => void;
}) {
  const [name, setName] = useState("");
  const [r2Prefix, setR2Prefix] = useState("");
  const [sampleEveryN, setSampleEveryN] = useState(String(DEFAULT_SAMPLE_EVERY_N));
  const [defaultFps, setDefaultFps] = useState(String(DEFAULT_FPS));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api("/api/admin/batches", "POST", {
        projectId,
        name,
        r2Prefix,
        sampleEveryN: Number(sampleEveryN),
        defaultFps: Number(defaultFps),
      });
      onDone();
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card space-y-3 p-4">
      <h2 className="text-sm font-semibold text-white">New batch</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Batch name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Batch 7 — kitchens" required />
        </div>
        <div>
          <label className="label">R2 prefix (optional)</label>
          <input className="input" value={r2Prefix} onChange={(e) => setR2Prefix(e.target.value)} placeholder="clips/batch7/" />
        </div>
        <div>
          <label className="label">Q sample cadence (every Nth frame)</label>
          <input className="input" type="number" min={1} value={sampleEveryN} onChange={(e) => setSampleEveryN(e.target.value)} />
        </div>
        <div>
          <label className="label">Default fps</label>
          <input className="input" type="number" min={1} step="0.001" value={defaultFps} onChange={(e) => setDefaultFps(e.target.value)} />
        </div>
      </div>
      {err && <p className="text-xs text-red-400">{err}</p>}
      <button type="submit" className="btn-primary" disabled={busy}>
        {busy ? "Creating…" : "Create batch"}
      </button>
    </form>
  );
}

function BatchCard({
  batch,
  r2Configured,
  onChange,
}: {
  batch: Batch;
  r2Configured: boolean;
  onChange: () => void;
}) {
  const [mode, setMode] = useState<
    "none" | "r2" | "r2sessions" | "manual" | "session"
  >("none");

  async function deleteClip(id: string) {
    if (!confirm("Remove this clip and its assignments?")) return;
    try {
      await api(`/api/admin/clips?id=${id}`, "DELETE");
      onChange();
    } catch (e) {
      alert((e as Error).message);
    }
  }

  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <div className="font-medium text-slate-100">{batch.name}</div>
          <div className="text-xs text-slate-500">
            Q every {batch.sampleEveryN}f · {batch.defaultFps} fps
            {batch.r2Prefix ? ` · prefix ${batch.r2Prefix}` : ""}
          </div>
        </div>
        <div className="ml-auto flex gap-2">
          {r2Configured && (
            <button
              className="btn-ghost text-xs"
              onClick={() => setMode(mode === "r2sessions" ? "none" : "r2sessions")}
            >
              Pull R2 sessions (bulk)
            </button>
          )}
          <button
            className="btn-ghost text-xs"
            onClick={() => setMode(mode === "session" ? "none" : "session")}
          >
            Import session (manifest)
          </button>
          {r2Configured && (
            <button
              className="btn-ghost text-xs"
              onClick={() => setMode(mode === "r2" ? "none" : "r2")}
            >
              Import from R2
            </button>
          )}
          <button
            className="btn-ghost text-xs"
            onClick={() => setMode(mode === "manual" ? "none" : "manual")}
          >
            Add manually
          </button>
        </div>
      </div>

      <PublishBatchControl batch={batch} r2Configured={r2Configured} onChange={onChange} />

      {mode === "r2sessions" && (
        <R2SessionBrowser
          batchId={batch.id}
          initialPrefix={batch.r2Prefix}
          onDone={() => {
            setMode("none");
            onChange();
          }}
        />
      )}
      {mode === "session" && (
        <SessionImportForm
          batchId={batch.id}
          r2Configured={r2Configured}
          onDone={() => {
            setMode("none");
            onChange();
          }}
        />
      )}
      {mode === "r2" && (
        <R2Browser
          batchId={batch.id}
          initialPrefix={batch.r2Prefix}
          onImported={() => {
            setMode("none");
            onChange();
          }}
        />
      )}
      {mode === "manual" && (
        <ManualClipForm
          batchId={batch.id}
          onDone={() => {
            setMode("none");
            onChange();
          }}
        />
      )}

      <div className="mt-3 border-t border-ink-700 pt-3">
        <div className="mb-2 text-xs font-medium text-slate-400">
          Clips ({batch.clips.length})
        </div>
        {batch.clips.length === 0 ? (
          <p className="text-xs text-slate-500">No clips yet.</p>
        ) : (
          <ul className="space-y-1">
            {batch.clips.map((c) => (
              <ClipRow
                key={c.id}
                clip={c}
                r2Configured={r2Configured}
                onDelete={() => deleteClip(c.id)}
                onChange={onChange}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// Batch delivery: publish all APPROVED assignments to R2 + write the manifest.
function PublishBatchControl({
  batch,
  r2Configured,
  onChange,
}: {
  batch: Batch;
  r2Configured: boolean;
  onChange: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  async function publish() {
    if (
      !confirm(
        `Publish ${batch.approvedCount} approved assignment(s) in “${batch.name}” to R2 and write the manifest?`,
      )
    )
      return;
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      const res = await api(`/api/admin/batches/${batch.id}/publish`, "POST");
      setResult(
        `${res.published} published${res.failed ? ` · ${res.failed} failed` : ""} · manifest ${res.manifestKey}`,
      );
      onChange();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-3 rounded-md border border-ink-700 bg-ink-800/40 px-3 py-2">
      <div className="min-w-0">
        <div className="text-xs font-medium text-slate-300">Delivery</div>
        <div className="truncate text-[11px] text-slate-500">
          {batch.manifestR2Key ? (
            <span title={batch.manifestR2Key}>
              manifest: <span className="font-mono">{batch.manifestR2Key}</span>
              {batch.publishedAt
                ? ` · ${new Date(batch.publishedAt).toLocaleString()}`
                : ""}
            </span>
          ) : (
            "Not published yet."
          )}
        </div>
      </div>
      <div className="ml-auto flex items-center gap-2">
        <span className="text-[11px] text-slate-500">
          {batch.approvedCount} approved
        </span>
        <button
          onClick={publish}
          disabled={busy || !r2Configured || batch.approvedCount === 0}
          title={
            !r2Configured
              ? "R2 not configured"
              : batch.approvedCount === 0
                ? "No approved assignments to publish"
                : "Publish approved exports + manifest to R2"
          }
          className="rounded border border-brand-600/50 bg-brand-600/10 px-2.5 py-1 text-xs text-brand-300 hover:bg-brand-600/20 disabled:opacity-40"
        >
          {busy ? "Publishing…" : batch.manifestR2Key ? "Re-publish batch" : "Publish batch"}
        </button>
      </div>
      {err && <p className="w-full text-xs text-red-400">{err}</p>}
      {result && <p className="w-full text-xs text-green-400">{result}</p>}
    </div>
  );
}

function ClipRow({
  clip: c,
  r2Configured,
  onDelete,
  onChange,
}: {
  clip: Clip;
  r2Configured: boolean;
  onDelete: () => void;
  onChange: () => void;
}) {
  const isSession = Boolean(c.sessionId);
  const [open, setOpen] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  const inFlight = c.proxyStatus === "queued" || c.proxyStatus === "transcoding";

  // While queued/transcoding, poll so the badge auto-advances (queued ->
  // transcoding -> ready/failed) with no manual refresh, plus an elapsed timer.
  useEffect(() => {
    if (!inFlight) return;
    const t0 = Date.now();
    setElapsed(0);
    const tick = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 1000);
    const poll = setInterval(async () => {
      try {
        const s = await api(`/api/admin/clips/${c.id}`, "GET");
        if (s.proxyStatus !== c.proxyStatus) {
          clearInterval(poll);
          clearInterval(tick);
          onChange();
        }
      } catch {
        /* keep polling */
      }
    }, 3000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.proxyStatus, c.id]);

  const mmss = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`;

  return (
    <li className="text-sm text-slate-300">
      <div className="flex items-center gap-2">
        <span className="text-slate-500">{isSession ? "🎬" : "▶"}</span>
        <span className="truncate">{c.title}</span>
        {isSession && (
          <span className="shrink-0 rounded bg-ink-700 px-1.5 py-0.5 text-[10px] text-slate-400">
            {c.segmentCount} seg · {c.dataType ?? "session"}
            {c.frameCount ? ` · ${c.frameCount}f` : ""}
          </span>
        )}
        {isSession && (
          <button
            onClick={() => setOpen((v) => !v)}
            title={c.proxyError ?? undefined}
            className={`flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] ${
              c.proxyStatus === "ready"
                ? "bg-green-900/40 text-green-300"
                : c.proxyStatus === "failed"
                  ? "bg-red-900/40 text-red-300"
                  : inFlight
                    ? "bg-blue-900/40 text-blue-300"
                    : "bg-amber-900/40 text-amber-300"
            }`}
          >
            {inFlight ? (
              <>
                <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-blue-300 border-t-transparent" />
                {c.proxyStatus} · {mmss}
              </>
            ) : (
              <>proxy: {c.proxyStatus} {open ? "▾" : "▸"}</>
            )}
          </button>
        )}
        <span className="ml-auto shrink-0 text-xs text-slate-500">
          {c.sizeBytes ? `${fmtBytes(c.sizeBytes)} · ` : ""}
          {c.assignmentCount} assigned
        </span>
        <button
          onClick={onDelete}
          className="shrink-0 text-xs text-red-400 hover:text-red-300"
        >
          ✕
        </button>
      </div>
      {c.assignments.length > 0 && (
        <div className="mt-1 flex flex-wrap items-center gap-1 pl-6 text-[11px]">
          <span className="text-slate-600">review:</span>
          {c.assignments.map((a) => (
            <Link
              key={a.id}
              href={`/annotate/${a.id}`}
              title={
                a.status === "SUBMITTED"
                  ? "Open to review (approve / reject)"
                  : "Open annotation"
              }
              className={`flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-slate-300 hover:border-brand-500 hover:text-white ${
                a.status === "SUBMITTED"
                  ? "border-amber-700/60 bg-amber-950/30 text-amber-300"
                  : "border-ink-700 bg-ink-800"
              }`}
            >
              {a.annotator} · {a.status.toLowerCase().replace("_", " ")}
              {a.status === "SUBMITTED" && " →"}
            </Link>
          ))}
        </div>
      )}
      {isSession && open && (
        <TranscodeProxyForm
          clip={c}
          r2Configured={r2Configured}
          onDone={onChange}
        />
      )}
    </li>
  );
}

// Close the MCAP -> playable-proxy loop for one session clip:
//   * auto: server runs transcode_session.py (needs R2 + Python) — "Run transcode";
//   * manual/demo: paste the script's metadata JSON (+ optional playback URL).
function TranscodeProxyForm({
  clip,
  r2Configured,
  onDone,
}: {
  clip: Clip;
  r2Configured: boolean;
  onDone: () => void;
}) {
  const [metaText, setMetaText] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [busy, setBusy] = useState<null | "run" | "save">(null);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function runTranscode() {
    setBusy("run");
    setErr(null);
    setOk(null);
    try {
      await api(`/api/admin/clips/${clip.id}/transcode`, "POST");
      setOk("Transcode started — it will report back and flip to ready.");
      setTimeout(onDone, 800);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function saveResult(e: React.FormEvent) {
    e.preventDefault();
    setBusy("save");
    setErr(null);
    setOk(null);
    try {
      let metadata: unknown;
      try {
        metadata = JSON.parse(metaText);
      } catch {
        throw new Error("Transcode metadata is not valid JSON.");
      }
      const res = await api(`/api/admin/clips/${clip.id}/proxy`, "POST", {
        metadata,
        sourceUrl: sourceUrl.trim() || undefined,
      });
      setOk(
        `Proxy ready · ${res.clip.frameCount}f @ ${res.clip.fps}fps · ${res.segmentsUpdated} segment ranges written.`,
      );
      setTimeout(onDone, 900);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-2 space-y-2 rounded-md bg-ink-800/50 p-3">
      <div className="flex items-center gap-2">
        <button
          className="btn-ghost text-xs"
          onClick={runTranscode}
          disabled={
            busy !== null ||
            clip.proxyStatus === "queued" ||
            clip.proxyStatus === "transcoding"
          }
        >
          {clip.proxyStatus === "queued" || clip.proxyStatus === "transcoding"
            ? `${clip.proxyStatus}…`
            : busy === "run"
              ? "Queuing…"
              : "▶ Queue transcode"}
        </button>
        {clip.proxyStatus === "queued" || clip.proxyStatus === "transcoding" ? (
          <span className="flex items-center gap-1 text-[11px] text-blue-300">
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-blue-300 border-t-transparent" />
            {clip.proxyStatus === "queued"
              ? "waiting for the transcode worker to pick it up"
              : "downloading blobs + encoding (a few minutes)"}
          </span>
        ) : (
          <span className="text-[11px] text-slate-500">
            {r2Configured
              ? "queues the job — run scripts/transcode_worker.py to process it"
              : "needs R2 creds — use the manual path below in demo mode"}
          </span>
        )}
      </div>
      {clip.proxyError && (
        <p className="text-xs text-red-400">Last error: {clip.proxyError}</p>
      )}

      <form onSubmit={saveResult} className="space-y-2 border-t border-ink-700 pt-2">
        <p className="text-[11px] text-slate-500">
          Or paste the JSON printed by{" "}
          <code>transcode_session.py</code> to record fps, frame count, and
          per-segment frame ranges (idempotent).
        </p>
        <textarea
          className="input min-h-[96px] font-mono text-xs"
          placeholder='{"fps":30,"frame_count":1234,"duration_sec":41.1,"segments":[{"logical_path":"…_004.mcap","start_frame":0,"end_frame":600}]}'
          value={metaText}
          onChange={(e) => setMetaText(e.target.value)}
        />
        <input
          className="input"
          placeholder="Playback URL for demo mode (optional — e.g. /proxies/foo.mp4 or https://…)"
          value={sourceUrl}
          onChange={(e) => setSourceUrl(e.target.value)}
        />
        {err && <p className="text-xs text-red-400">{err}</p>}
        {ok && <p className="text-xs text-green-400">{ok}</p>}
        <button type="submit" className="btn-primary text-xs" disabled={busy !== null}>
          {busy === "save" ? "Saving…" : "Save transcode result"}
        </button>
      </form>
    </div>
  );
}

type R2Session = {
  key: string;
  sessionId: string;
  dataType: string | null;
  worker: string | null;
  size: number;
};

function R2SessionBrowser({
  batchId,
  initialPrefix,
  onDone,
}: {
  batchId: string;
  initialPrefix: string;
  onDone: () => void;
}) {
  const [prefix, setPrefix] = useState(initialPrefix || "");
  const [sessions, setSessions] = useState<R2Session[]>([]);
  const [nextToken, setNextToken] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [autoTranscode, setAutoTranscode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const load = useCallback(async (p: string, token?: string) => {
    setLoading(true);
    setErr(null);
    try {
      const qs = new URLSearchParams({ prefix: p });
      if (token) qs.set("token", token);
      const data = await api(`/api/admin/r2/sessions?${qs.toString()}`, "GET");
      setSessions((prev) => (token ? [...prev, ...data.sessions] : data.sessions));
      setNextToken(data.nextToken ?? null);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function doImport() {
    if (selected.size === 0) return;
    setImporting(true);
    setErr(null);
    setResult(null);
    try {
      const res = await api("/api/admin/sessions/bulk-import", "POST", {
        batchId,
        manifestKeys: [...selected],
        autoTranscode,
      });
      const parts = [`${res.imported} imported`, `${res.updated} updated`];
      if (autoTranscode) parts.push(`${res.transcodeStarted} transcodes started`);
      if (res.failed.length) parts.push(`${res.failed.length} failed`);
      setResult(parts.join(" · "));
      setSelected(new Set());
      setTimeout(onDone, 1200);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="mt-3 space-y-2 rounded-md border border-ink-700 bg-ink-800/40 p-3">
      <p className="text-xs text-slate-400">
        List session <code>manifest.json</code> files under an R2 prefix and import
        many at once. Point the prefix at a worksite/worker (e.g.{" "}
        <code>tenants/&lt;t&gt;/worksites/</code>) to skip the content blobs.
      </p>
      <div className="flex gap-2">
        <input
          className="input font-mono text-xs"
          value={prefix}
          onChange={(e) => setPrefix(e.target.value)}
          placeholder="tenants/<tenant>/worksites/"
        />
        <button
          className="btn-primary shrink-0 text-xs"
          onClick={() => load(prefix)}
          disabled={loading}
        >
          {loading ? "Loading…" : "List sessions"}
        </button>
      </div>

      {sessions.length > 0 && (
        <>
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>{sessions.length} sessions</span>
            <button
              className="text-brand-400 hover:underline"
              onClick={() => setSelected(new Set(sessions.map((s) => s.key)))}
            >
              Select all
            </button>
          </div>
          <ul className="max-h-64 space-y-0.5 overflow-auto">
            {sessions.map((s) => (
              <li key={s.key}>
                <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm text-slate-200 hover:bg-ink-700">
                  <input
                    type="checkbox"
                    checked={selected.has(s.key)}
                    onChange={() => toggle(s.key)}
                  />
                  <span>🎬</span>
                  <span className="truncate font-mono text-xs">{s.sessionId}</span>
                  <span className="shrink-0 rounded bg-ink-700 px-1.5 py-0.5 text-[10px] text-slate-400">
                    {s.dataType ?? "session"}
                    {s.worker ? ` · ${s.worker}` : ""}
                  </span>
                  <span className="ml-auto shrink-0 text-xs text-slate-500">
                    {fmtBytes(s.size)}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {nextToken && (
            <button
              className="btn-ghost w-full text-xs"
              onClick={() => load(prefix, nextToken)}
              disabled={loading}
            >
              {loading ? "Loading…" : "Load more"}
            </button>
          )}
        </>
      )}

      {err && <p className="text-xs text-red-400">{err}</p>}
      {result && <p className="text-xs text-green-400">{result}</p>}

      <div className="flex items-center justify-between border-t border-ink-700 pt-2">
        <label className="flex items-center gap-2 text-xs text-slate-400">
          <input
            type="checkbox"
            checked={autoTranscode}
            onChange={(e) => setAutoTranscode(e.target.checked)}
          />
          Auto-start transcode after import
        </label>
        <button
          className="btn-primary text-xs"
          disabled={selected.size === 0 || importing}
          onClick={doImport}
        >
          {importing ? "Importing…" : `Import ${selected.size} session${selected.size === 1 ? "" : "s"}`}
        </button>
      </div>
    </div>
  );
}

function SessionImportForm({
  batchId,
  r2Configured,
  onDone,
}: {
  batchId: string;
  r2Configured: boolean;
  onDone: () => void;
}) {
  const [title, setTitle] = useState("");
  const [manifestText, setManifestText] = useState("");
  const [manifestKey, setManifestKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setOk(null);
    try {
      const payload: Record<string, unknown> = { batchId, title };
      if (manifestText.trim()) {
        try {
          payload.manifest = JSON.parse(manifestText);
        } catch {
          throw new Error("Pasted manifest is not valid JSON.");
        }
      } else if (manifestKey.trim()) {
        payload.manifestKey = manifestKey.trim();
      } else {
        throw new Error("Paste a manifest.json or give its R2 key.");
      }
      const res = await api("/api/admin/sessions/import", "POST", payload);
      setOk(
        `${res.updated ? "Updated" : "Imported"} session with ${res.segments} MCAP segment(s).`,
      );
      setManifestText("");
      setManifestKey("");
      setTitle("");
      setTimeout(onDone, 700);
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-3 space-y-2 rounded-md bg-ink-800/50 p-3">
      <p className="text-xs text-slate-400">
        Import a recording session from its upload <code>manifest.json</code>. Each
        session becomes one clip; its 4-min MCAP segments are recorded as
        provenance and a playable MP4 proxy is transcoded from them.
      </p>
      <input
        className="input"
        placeholder="Clip title (optional — defaults to data_type + session id)"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <textarea
        className="input min-h-[120px] font-mono text-xs"
        placeholder='Paste manifest.json here — {"session_id":"…","assets":[…]}'
        value={manifestText}
        onChange={(e) => setManifestText(e.target.value)}
      />
      {r2Configured && (
        <input
          className="input"
          placeholder="…or manifest R2 key (tenants/…/sessions/<id>/manifest.json)"
          value={manifestKey}
          onChange={(e) => setManifestKey(e.target.value)}
        />
      )}
      {err && <p className="text-xs text-red-400">{err}</p>}
      {ok && <p className="text-xs text-green-400">{ok}</p>}
      <button type="submit" className="btn-primary" disabled={busy}>
        {busy ? "Importing…" : "Import session"}
      </button>
    </form>
  );
}

function ManualClipForm({ batchId, onDone }: { batchId: string; onDone: () => void }) {
  const [title, setTitle] = useState("");
  const [r2Key, setR2Key] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api("/api/admin/clips", "POST", { batchId, title, r2Key, sourceUrl });
      onDone();
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-3 space-y-2 rounded-md bg-ink-800/50 p-3">
      <input className="input" placeholder="Clip title" value={title} onChange={(e) => setTitle(e.target.value)} required />
      <input className="input" placeholder="R2 object key (e.g. clips/batch7/a.mp4)" value={r2Key} onChange={(e) => setR2Key(e.target.value)} />
      <input className="input" placeholder="…or fallback source URL (demo mode)" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} />
      {err && <p className="text-xs text-red-400">{err}</p>}
      <button type="submit" className="btn-primary" disabled={busy}>
        {busy ? "Adding…" : "Add clip"}
      </button>
    </form>
  );
}

type R2Obj = { key: string; size: number; isVideo: boolean };

function R2Browser({
  batchId,
  initialPrefix,
  onImported,
}: {
  batchId: string;
  initialPrefix: string;
  onImported: () => void;
}) {
  const [prefix, setPrefix] = useState(initialPrefix || "");
  const [prefixes, setPrefixes] = useState<string[]>([]);
  const [objects, setObjects] = useState<R2Obj[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async (p: string) => {
    setLoading(true);
    setErr(null);
    try {
      const data = await api(
        `/api/admin/r2/list?prefix=${encodeURIComponent(p)}`,
        "GET",
      );
      setPrefix(p);
      setPrefixes(data.prefixes ?? []);
      setObjects(data.objects ?? []);
      setSelected(new Set());
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  // load on first open
  useEffect(() => {
    load(initialPrefix || "");
  }, [load, initialPrefix]);

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function selectAllVideos() {
    setSelected(new Set(objects.filter((o) => o.isVideo).map((o) => o.key)));
  }

  async function doImport() {
    if (selected.size === 0) return;
    setImporting(true);
    setErr(null);
    try {
      const clips = objects
        .filter((o) => selected.has(o.key))
        .map((o) => ({ key: o.key, size: o.size }));
      const res = await api("/api/admin/r2/import", "POST", { batchId, clips });
      alert(`Imported ${res.imported}, skipped ${res.skipped} (already present).`);
      onImported();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setImporting(false);
    }
  }

  const parent = prefix.replace(/[^/]+\/$/, ""); // one level up

  return (
    <div className="mt-3 rounded-md border border-ink-700 bg-ink-800/40 p-3">
      <div className="mb-2 flex items-center gap-2 text-xs">
        <span className="text-slate-500">Bucket path:</span>
        <span className="font-mono text-slate-300">/{prefix || ""}</span>
        {prefix && (
          <button className="text-brand-400 hover:underline" onClick={() => load(parent)}>
            ↑ up
          </button>
        )}
        <button className="ml-auto text-brand-400 hover:underline" onClick={() => load(prefix)}>
          ⟳ refresh
        </button>
      </div>

      {loading ? (
        <p className="py-4 text-center text-xs text-slate-500">Loading…</p>
      ) : (
        <>
          {prefixes.length > 0 && (
            <ul className="mb-2 space-y-0.5">
              {prefixes.map((p) => (
                <li key={p}>
                  <button
                    onClick={() => load(p)}
                    className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm text-slate-300 hover:bg-ink-700"
                  >
                    <span>📁</span>
                    <span className="font-mono">{p.replace(prefix, "")}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {objects.length === 0 && prefixes.length === 0 && (
            <p className="py-4 text-center text-xs text-slate-500">
              Nothing here.
            </p>
          )}

          {objects.length > 0 && (
            <>
              <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
                <span>{objects.length} objects</span>
                <button className="text-brand-400 hover:underline" onClick={selectAllVideos}>
                  Select all videos
                </button>
              </div>
              <ul className="max-h-64 space-y-0.5 overflow-auto">
                {objects.map((o) => (
                  <li key={o.key}>
                    <label
                      className={`flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm ${
                        o.isVideo ? "text-slate-200" : "text-slate-500"
                      } hover:bg-ink-700`}
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(o.key)}
                        onChange={() => toggle(o.key)}
                        disabled={!o.isVideo}
                      />
                      <span>{o.isVideo ? "🎞️" : "📄"}</span>
                      <span className="truncate font-mono">
                        {o.key.replace(prefix, "")}
                      </span>
                      <span className="ml-auto shrink-0 text-xs text-slate-500">
                        {fmtBytes(o.size)}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}

      {err && <p className="mt-2 text-xs text-red-400">{err}</p>}

      <div className="mt-3 flex items-center justify-between">
        <span className="text-xs text-slate-500">{selected.size} selected</span>
        <button
          className="btn-primary text-xs"
          disabled={selected.size === 0 || importing}
          onClick={doImport}
        >
          {importing ? "Importing…" : `Import ${selected.size} clip${selected.size === 1 ? "" : "s"}`}
        </button>
      </div>
    </div>
  );
}
