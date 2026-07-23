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
        <h1 className="font-serif text-2xl font-medium text-ink-900">
          {project.name}{" "}
          <span className="font-sans text-sm font-normal text-ink-500">
            · {project.batches.length} batches
          </span>
        </h1>
        <button className="btn-primary" onClick={() => setShowNew((v) => !v)}>
          {showNew ? "Close" : "+ New batch"}
        </button>
      </div>

      {!r2Configured && (
        <p className="mb-4 rounded-lg border border-accent-yellow/30 bg-accent-yellow/10 px-3 py-2 text-xs text-accent-yellow">
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
    <form onSubmit={submit} className="card space-y-4 p-5">
      <h2 className="text-sm font-medium text-ink-900">New batch</h2>
      <div className="grid gap-4 sm:grid-cols-2">
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
      {err && <p className="text-xs text-accent-red">{err}</p>}
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

  // Bulk selection over this batch's clips. Kept here rather than in ClipRow so
  // one toolbar can act on the whole selection.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState<string | null>(null);
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Only clips that can actually be transcoded are worth selecting for it: a
  // session with segments, or a flat clip with an R2 object behind it.
  const selectableIds = batch.clips
    .filter((c) => c.sessionId || c.r2Key)
    .map((c) => c.id);
  const selectedClips = batch.clips.filter((c) => selected.has(c.id));
  const selectedAssignmentIds = selectedClips.flatMap((c) => c.assignments.map((a) => a.id));

  async function deleteClip(id: string) {
    if (!confirm("Remove this clip and its assignments?")) return;
    try {
      await api(`/api/admin/clips?id=${id}`, "DELETE");
      onChange();
    } catch (e) {
      alert((e as Error).message);
    }
  }

  async function bulkTranscode() {
    setBulkBusy("transcode");
    setBulkMsg(null);
    try {
      const res = await api("/api/admin/clips/bulk-transcode", "POST", {
        clipIds: [...selected],
        // Selecting a clip and pressing the button is an explicit instruction to
        // run it, so clear any stale in-flight state left by a killed worker
        // rather than silently reporting it as skipped.
        force: true,
      });
      // Name the first couple of skip reasons — "3 skipped" alone doesn't tell
      // you whether they were already running or had nothing to transcode.
      const reasons = [
        ...new Set(
          (res.results as { ok: boolean; error?: string }[])
            .filter((r) => !r.ok && r.error)
            .map((r) => r.error as string),
        ),
      ].slice(0, 2);
      setBulkMsg(
        `${res.queued} queued` +
          (res.skipped ? ` · ${res.skipped} skipped${reasons.length ? `: ${reasons.join("; ")}` : ""}` : ""),
      );
      setSelected(new Set());
      onChange();
    } catch (e) {
      setBulkMsg((e as Error).message);
    } finally {
      setBulkBusy(null);
    }
  }

  async function bulkDeleteAssignments() {
    setBulkBusy("assignments");
    setBulkMsg(null);
    try {
      // Ask the server how much work is at stake first, so the confirmation
      // quotes real task counts instead of a vague warning.
      const info = await api("/api/admin/assignments", "POST", {
        assignmentIds: selectedAssignmentIds,
      });
      const ok = confirm(
        `Delete ${info.assignments.length} assignment(s) across ${selectedClips.length} clip(s)?\n\n` +
          `This permanently deletes ${info.taskTotal} annotation task(s) and their sub-tasks and frame quality rows. It cannot be undone.\n\n` +
          info.assignments
            .slice(0, 8)
            .map(
              (a: { annotator: string; status: string; taskCount: number }) =>
                `  • ${a.annotator} — ${a.status.toLowerCase().replace(/_/g, " ")} · ${a.taskCount} task(s)`,
            )
            .join("\n") +
          (info.assignments.length > 8 ? `\n  … and ${info.assignments.length - 8} more` : ""),
      );
      if (!ok) {
        setBulkBusy(null);
        return;
      }
      const res = await api("/api/admin/assignments", "DELETE", {
        assignmentIds: selectedAssignmentIds,
      });
      setBulkMsg(`${res.deleted} assignment(s) deleted`);
      setSelected(new Set());
      onChange();
    } catch (e) {
      setBulkMsg((e as Error).message);
    } finally {
      setBulkBusy(null);
    }
  }

  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <div className="font-medium text-ink-900">{batch.name}</div>
          <div className="text-xs text-ink-400">
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

      <div className="mt-3 border-t border-ink-900/10 pt-3">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <div className="text-xs font-medium text-ink-500">
            Clips ({batch.clips.length})
          </div>
          {batch.clips.length > 0 && (
            <button
              onClick={() =>
                setSelected((prev) =>
                  prev.size === selectableIds.length ? new Set() : new Set(selectableIds),
                )
              }
              className="text-[11px] text-ink-400 transition-colors duration-150 hover:text-ink-800"
            >
              {selected.size === selectableIds.length && selectableIds.length > 0
                ? "Clear selection"
                : `Select all (${selectableIds.length})`}
            </button>
          )}
        </div>

        {selected.size > 0 && (
          <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-accent-blue/25 bg-accent-blue/5 px-3 py-2">
            <span className="text-xs text-ink-700">{selected.size} selected</span>
            <button
              onClick={bulkTranscode}
              disabled={bulkBusy !== null || !r2Configured}
              title={
                r2Configured
                  ? "Queue the proxy transcode for every selected clip"
                  : "R2 not configured"
              }
              className="rounded-lg border border-accent-blue/40 bg-accent-blue/5 px-2.5 py-1 text-xs text-accent-blue transition-colors duration-150 hover:bg-accent-blue/10 disabled:opacity-40"
            >
              {bulkBusy === "transcode" ? "Queuing…" : `▶ Queue transcode (${selected.size})`}
            </button>
            <button
              onClick={bulkDeleteAssignments}
              disabled={bulkBusy !== null || selectedAssignmentIds.length === 0}
              title={
                selectedAssignmentIds.length === 0
                  ? "No assignments on the selected clips"
                  : "Delete every assignment on the selected clips — destroys their annotations"
              }
              className="rounded-lg border border-accent-red/40 px-2.5 py-1 text-xs text-accent-red transition-colors duration-150 hover:bg-accent-red/10 disabled:opacity-40"
            >
              {bulkBusy === "assignments"
                ? "Deleting…"
                : `Delete assignments (${selectedAssignmentIds.length})`}
            </button>
            <button
              onClick={() => setSelected(new Set())}
              className="text-[11px] text-ink-400 transition-colors duration-150 hover:text-ink-800"
            >
              Clear
            </button>
          </div>
        )}
        {bulkMsg && <p className="mb-2 text-xs text-ink-500">{bulkMsg}</p>}

        {batch.clips.length === 0 ? (
          <p className="text-xs text-ink-400">No clips yet.</p>
        ) : (
          <ul className="space-y-1">
            {batch.clips.map((c) => (
              <ClipRow
                key={c.id}
                clip={c}
                r2Configured={r2Configured}
                selected={selected.has(c.id)}
                selectable={Boolean(c.sessionId || c.r2Key)}
                onToggleSelected={() => toggleSelected(c.id)}
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
    <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-ink-900/10 bg-paper-50 px-3 py-2">
      <div className="min-w-0">
        <div className="text-xs font-medium text-ink-700">Delivery</div>
        <div className="truncate text-[11px] text-ink-400">
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
        <span className="text-[11px] text-ink-400">
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
          className="rounded-lg border border-accent-blue/40 bg-accent-blue/5 px-2.5 py-1 text-xs text-accent-blue transition-colors duration-150 hover:bg-accent-blue/10 disabled:opacity-40"
        >
          {busy ? "Publishing…" : batch.manifestR2Key ? "Re-publish batch" : "Publish batch"}
        </button>
      </div>
      {err && <p className="w-full text-xs text-accent-red">{err}</p>}
      {result && <p className="w-full text-xs text-accent-green">{result}</p>}
    </div>
  );
}

function ClipRow({
  clip: c,
  r2Configured,
  selected,
  selectable,
  onToggleSelected,
  onDelete,
  onChange,
}: {
  clip: Clip;
  r2Configured: boolean;
  selected: boolean;
  selectable: boolean;
  onToggleSelected: () => void;
  onDelete: () => void;
  onChange: () => void;
}) {
  const isSession = Boolean(c.sessionId);
  // Flat clips (a single MP4 imported from the bucket) can be transcoded too.
  // They already play, but they carry the recorder's GOP and resolution, so
  // scrubbing them stalls until they get the same proxy a session gets.
  const canTranscode = isSession || Boolean(c.r2Key);
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

  async function onDeleteAssignment(a: { id: string; annotator: string; status: string }) {
    // Look up the real task count first — "are you sure" is worthless when the
    // answer depends on whether this annotator has done 0 tasks or 40.
    let detail = "";
    try {
      const info = await api("/api/admin/assignments", "POST", { assignmentIds: [a.id] });
      detail = `\n\nThis permanently deletes ${info.taskTotal} annotation task(s) and their sub-tasks. It cannot be undone.`;
    } catch {
      detail = "\n\nThis also deletes their annotations on this clip. It cannot be undone.";
    }
    if (!confirm(`Delete ${a.annotator}'s assignment on “${c.title}”?${detail}`)) return;
    try {
      await api("/api/admin/assignments", "DELETE", { assignmentIds: [a.id] });
      onChange();
    } catch (e) {
      alert((e as Error).message);
    }
  }

  return (
    <li className={`text-sm text-ink-700 ${selected ? "rounded bg-accent-blue/5" : ""}`}>
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={selected}
          disabled={!selectable}
          onChange={onToggleSelected}
          title={
            selectable
              ? "Select for bulk actions"
              : "Nothing to transcode on this clip (no session segments, no R2 object)"
          }
          className="h-3.5 w-3.5 shrink-0 accent-accent-blue disabled:opacity-25"
        />
        <span className="text-ink-400">{isSession ? "🎬" : "▶"}</span>
        <span className="truncate">{c.title}</span>
        {isSession && (
          <span className="shrink-0 rounded bg-ink-900/5 px-1.5 py-0.5 text-[10px] text-ink-500">
            {c.segmentCount} seg · {c.dataType ?? "session"}
            {c.frameCount ? ` · ${c.frameCount}f` : ""}
          </span>
        )}
        {canTranscode && (
          <button
            onClick={() => setOpen((v) => !v)}
            title={c.proxyError ?? undefined}
            className={`flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] ${
              c.proxyStatus === "ready"
                ? "bg-accent-green/10 text-accent-green"
                : c.proxyStatus === "failed"
                  ? "bg-accent-red/10 text-accent-red"
                  : inFlight
                    ? "bg-accent-blue/10 text-accent-blue"
                    : "bg-accent-yellow/10 text-accent-yellow"
            }`}
          >
            {inFlight ? (
              <>
                <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-accent-blue border-t-transparent" />
                {c.proxyStatus} · {mmss}
              </>
            ) : (
              <>proxy: {c.proxyStatus} {open ? "▾" : "▸"}</>
            )}
          </button>
        )}
        <span className="ml-auto shrink-0 text-xs text-ink-400">
          {c.sizeBytes ? `${fmtBytes(c.sizeBytes)} · ` : ""}
          {c.assignmentCount} assigned
        </span>
        <button
          onClick={onDelete}
          className="shrink-0 text-xs text-accent-red/70 transition-colors duration-150 hover:text-accent-red"
        >
          ✕
        </button>
      </div>
      {c.assignments.length > 0 && (
        <div className="mt-1 flex flex-wrap items-center gap-1 pl-6 text-[11px]">
          <span className="text-ink-300">review:</span>
          {c.assignments.map((a) => (
            <span
              key={a.id}
              className={`flex items-center rounded-full border transition-colors duration-150 hover:border-accent-blue/60 ${
                a.status === "SUBMITTED"
                  ? "border-accent-yellow/30 bg-accent-yellow/10 text-accent-yellow"
                  : "border-ink-900/10 bg-ink-900/[0.03] text-ink-700"
              }`}
            >
              <Link
                href={`/annotate/${a.id}`}
                title={
                  a.status === "SUBMITTED"
                    ? "Open to review (approve / reject)"
                    : "Open annotation"
                }
                className="py-0.5 pl-1.5 hover:text-ink-900"
              >
                {a.annotator} · {a.status.toLowerCase().replace("_", " ")}
                {a.status === "SUBMITTED" && " →"}
              </Link>
              {/* Single-assignment removal, so pulling one annotator off a clip
                  doesn't mean selecting the clip and wiping everyone's work. */}
              <button
                onClick={() => onDeleteAssignment(a)}
                title={`Delete ${a.annotator}'s assignment and their annotations on this clip`}
                className="px-1.5 py-0.5 text-ink-300 transition-colors duration-150 hover:text-accent-red"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      {canTranscode && open && (
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

  async function runTranscode(force = false) {
    setBusy("run");
    setErr(null);
    setOk(null);
    try {
      await api(`/api/admin/clips/${clip.id}/transcode`, "POST", { force });
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
    <div className="mt-2 space-y-2 rounded-lg border border-ink-900/10 bg-paper-50 p-3">
      <div className="flex items-center gap-2">
        <button
          className="btn-ghost text-xs"
          onClick={() => runTranscode()}
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
          <span className="flex items-center gap-1 text-[11px] text-accent-blue">
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-accent-blue border-t-transparent" />
            {clip.proxyStatus === "queued"
              ? "waiting for the transcode worker to pick it up"
              : clip.sessionId
                ? "downloading blobs + encoding (a few minutes)"
                : "downloading the source video + encoding (a few minutes)"}
            {/* A worker killed mid-job (redeploy, OOM) never reports back, so
                the clip sits here forever. This is the way out. */}
            <button
              onClick={() => runTranscode(true)}
              disabled={busy !== null}
              title="Worker restarted mid-job? Clear the stuck state and queue it again."
              className="ml-1 text-ink-400 underline transition-colors duration-150 hover:text-ink-900"
            >
              stuck? re-queue
            </button>
          </span>
        ) : (
          <span className="text-[11px] text-ink-400">
            {r2Configured
              ? "queues the job — run scripts/transcode_worker.py to process it"
              : "needs R2 creds — use the manual path below in demo mode"}
          </span>
        )}
      </div>
      {clip.proxyError && (
        <p className="text-xs text-accent-red">Last error: {clip.proxyError}</p>
      )}

      <form onSubmit={saveResult} className="space-y-2 border-t border-ink-900/10 pt-2">
        <p className="text-[11px] text-ink-400">
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
        {err && <p className="text-xs text-accent-red">{err}</p>}
        {ok && <p className="text-xs text-accent-green">{ok}</p>}
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
  const [folders, setFolders] = useState<string[]>([]);
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

  // Folder drill-down: list the sub-"folders" at a prefix so you can click
  // through tenants → worksites → workers instead of typing the full path.
  const browse = useCallback(async (p: string) => {
    setLoading(true);
    setErr(null);
    try {
      const data = await api(`/api/admin/r2/list?prefix=${encodeURIComponent(p)}`, "GET");
      setPrefix(p);
      setFolders(data.prefixes ?? []);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Open at the batch's configured prefix (or bucket root).
  useEffect(() => {
    browse(initialPrefix || "");
  }, [browse, initialPrefix]);

  // Breadcrumb segments from the current prefix, each linking to that level.
  const crumbs: { label: string; path: string }[] = [];
  {
    const parts = prefix.split("/").filter(Boolean);
    let acc = "";
    for (const part of parts) {
      acc += part + "/";
      crumbs.push({ label: part, path: acc });
    }
  }

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
    <div className="mt-3 space-y-2 rounded-lg border border-ink-900/10 bg-paper-50 p-3">
      <p className="text-xs text-ink-500">
        Click through the folders to a worksite/worker, then{" "}
        <b>List sessions here</b> to find every <code>manifest.json</code> under it
        and import many at once. Or type a prefix directly.
      </p>

      {/* Breadcrumb */}
      <div className="flex flex-wrap items-center gap-1 text-xs">
        <button className="link" onClick={() => browse("")}>
          bucket
        </button>
        {crumbs.map((c) => (
          <span key={c.path} className="flex items-center gap-1">
            <span className="text-ink-300">/</span>
            <button className="link" onClick={() => browse(c.path)}>
              {c.label}
            </button>
          </span>
        ))}
      </div>

      {/* Clickable sub-folders at the current level */}
      {folders.length > 0 && (
        <ul className="flex flex-wrap gap-1">
          {folders.map((f) => (
            <li key={f}>
              <button
                onClick={() => browse(f)}
                disabled={loading}
                className="flex items-center gap-1 rounded-lg border border-ink-900/10 px-2 py-1 text-xs text-ink-800 transition-colors duration-150 hover:border-ink-900/20 hover:bg-ink-900/5"
              >
                📁 {f.replace(prefix, "").replace(/\/$/, "")}
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Manual prefix + list action */}
      <div className="flex gap-2">
        <input
          className="input font-mono text-xs"
          value={prefix}
          onChange={(e) => setPrefix(e.target.value)}
          placeholder="tenants/<tenant>/worksites/"
        />
        <button
          className="btn-ghost shrink-0 text-xs"
          onClick={() => browse(prefix)}
          disabled={loading}
          title="Show folders at this prefix"
        >
          Go
        </button>
        <button
          className="btn-primary shrink-0 text-xs"
          onClick={() => load(prefix)}
          disabled={loading}
          title="Scan for session manifests under the current folder"
        >
          {loading ? "Loading…" : "List sessions here"}
        </button>
      </div>

      {sessions.length > 0 && (
        <>
          <div className="flex items-center justify-between text-xs text-ink-400">
            <span>{sessions.length} sessions</span>
            <button
              className="link"
              onClick={() => setSelected(new Set(sessions.map((s) => s.key)))}
            >
              Select all
            </button>
          </div>
          <ul className="max-h-64 space-y-0.5 overflow-auto">
            {sessions.map((s) => (
              <li key={s.key}>
                <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-sm text-ink-800 transition-colors duration-150 hover:bg-ink-900/5">
                  <input
                    type="checkbox"
                    checked={selected.has(s.key)}
                    onChange={() => toggle(s.key)}
                  />
                  <span>🎬</span>
                  <span className="truncate font-mono text-xs">{s.sessionId}</span>
                  <span className="shrink-0 rounded bg-ink-900/5 px-1.5 py-0.5 text-[10px] text-ink-500">
                    {s.dataType ?? "session"}
                    {s.worker ? ` · ${s.worker}` : ""}
                  </span>
                  <span className="ml-auto shrink-0 text-xs text-ink-400">
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

      {err && <p className="text-xs text-accent-red">{err}</p>}
      {result && <p className="text-xs text-accent-green">{result}</p>}

      <div className="flex items-center justify-between border-t border-ink-900/10 pt-2">
        <label className="flex items-center gap-2 text-xs text-ink-500">
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
    <form onSubmit={submit} className="mt-3 space-y-2 rounded-lg border border-ink-900/10 bg-paper-50 p-3">
      <p className="text-xs text-ink-500">
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
      {err && <p className="text-xs text-accent-red">{err}</p>}
      {ok && <p className="text-xs text-accent-green">{ok}</p>}
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
    <form onSubmit={submit} className="mt-3 space-y-2 rounded-lg border border-ink-900/10 bg-paper-50 p-3">
      <input className="input" placeholder="Clip title" value={title} onChange={(e) => setTitle(e.target.value)} required />
      <input className="input" placeholder="R2 object key (e.g. clips/batch7/a.mp4)" value={r2Key} onChange={(e) => setR2Key(e.target.value)} />
      <input className="input" placeholder="…or fallback source URL (demo mode)" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} />
      {err && <p className="text-xs text-accent-red">{err}</p>}
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
    <div className="mt-3 rounded-lg border border-ink-900/10 bg-paper-50 p-3">
      <div className="mb-2 flex items-center gap-2 text-xs">
        <span className="text-ink-400">Bucket path:</span>
        <span className="font-mono text-ink-700">/{prefix || ""}</span>
        {prefix && (
          <button className="link" onClick={() => load(parent)}>
            ↑ up
          </button>
        )}
        <button className="link ml-auto" onClick={() => load(prefix)}>
          ⟳ refresh
        </button>
      </div>

      {loading ? (
        <p className="py-4 text-center text-xs text-ink-400">Loading…</p>
      ) : (
        <>
          {prefixes.length > 0 && (
            <ul className="mb-2 space-y-0.5">
              {prefixes.map((p) => (
                <li key={p}>
                  <button
                    onClick={() => load(p)}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-sm text-ink-700 transition-colors duration-150 hover:bg-ink-900/5"
                  >
                    <span>📁</span>
                    <span className="font-mono">{p.replace(prefix, "")}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {objects.length === 0 && prefixes.length === 0 && (
            <p className="py-4 text-center text-xs text-ink-400">
              Nothing here.
            </p>
          )}

          {objects.length > 0 && (
            <>
              <div className="mb-1 flex items-center justify-between text-xs text-ink-400">
                <span>{objects.length} objects</span>
                <button className="link" onClick={selectAllVideos}>
                  Select all videos
                </button>
              </div>
              <ul className="max-h-64 space-y-0.5 overflow-auto">
                {objects.map((o) => (
                  <li key={o.key}>
                    <label
                      className={`flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-sm ${
                        o.isVideo ? "text-ink-800" : "text-ink-400"
                      } transition-colors duration-150 hover:bg-ink-900/5`}
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
                      <span className="ml-auto shrink-0 text-xs text-ink-400">
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

      {err && <p className="mt-2 text-xs text-accent-red">{err}</p>}

      <div className="mt-3 flex items-center justify-between">
        <span className="text-xs text-ink-400">{selected.size} selected</span>
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
