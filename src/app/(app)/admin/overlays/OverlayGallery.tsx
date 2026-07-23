"use client";

import { useEffect, useState } from "react";

type Row = {
  id: string;
  annotator: string;
  clipTitle: string;
  project: string;
  batch: string;
  isSession: boolean;
  hasOriginal: boolean;
  hasProxy: boolean;
  exportR2Key: string | null;
  overlayStatus: string;
  overlayR2Key: string | null;
  overlayError: string | null;
  overlaySource: string;
  overlayRenderedAt: string | null;
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

export default function OverlayGallery({
  rows,
  r2Configured,
}: {
  rows: Row[];
  r2Configured: boolean;
}) {
  const [filter, setFilter] = useState<"all" | "ready" | "pending" | "failed">("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [playing, setPlaying] = useState<{ id: string; url: string } | null>(null);

  const bucket = (r: Row) =>
    r.overlayStatus === "ready"
      ? "ready"
      : r.overlayStatus === "failed"
        ? "failed"
        : "pending";
  const shown = rows.filter((r) => filter === "all" || bucket(r) === filter);
  const counts = {
    all: rows.length,
    ready: rows.filter((r) => bucket(r) === "ready").length,
    pending: rows.filter((r) => bucket(r) === "pending").length,
    failed: rows.filter((r) => bucket(r) === "failed").length,
  };

  // Anything queued or rendering resolves in the background, so poll while any
  // row is in flight and stop as soon as the page is settled.
  const inFlight = rows.some(
    (r) => r.overlayStatus === "queued" || r.overlayStatus === "rendering",
  );
  useEffect(() => {
    if (!inFlight) return;
    const t = setInterval(() => window.location.reload(), 5000);
    return () => clearInterval(t);
  }, [inFlight]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function render(ids: string[], source: "original" | "proxy") {
    setBusy(true);
    setMsg(null);
    let ok = 0;
    const errors: string[] = [];
    for (const id of ids) {
      try {
        await api(`/api/admin/assignments/${id}/overlay`, "PATCH", { source });
        ok++;
      } catch (e) {
        errors.push((e as Error).message);
      }
    }
    setMsg(
      `${ok} queued onto the ${source}` +
        (errors.length ? ` · ${errors.length} failed: ${[...new Set(errors)][0]}` : ""),
    );
    setSelected(new Set());
    setBusy(false);
    if (ok) window.location.reload();
  }

  async function play(id: string) {
    setMsg(null);
    try {
      const { url } = await api(`/api/admin/assignments/${id}/overlay`, "GET");
      setPlaying({ id, url });
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  if (rows.length === 0) {
    return (
      <div className="card py-12 text-center text-sm text-ink-400">
        No approved assignments yet. Overlays are rendered from approved work
        only — approve and publish a clip in Review first.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {(["all", "ready", "pending", "failed"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors duration-150 ${
              filter === f
                ? "border-accent-blue/40 bg-accent-blue/10 text-accent-blue"
                : "border-ink-900/15 text-ink-500 hover:border-ink-900/30"
            }`}
          >
            {f} ({counts[f]})
          </button>
        ))}
        {!r2Configured && (
          <span className="text-xs text-accent-yellow">
            R2 not configured — rendering and playback are unavailable.
          </span>
        )}
      </div>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-accent-blue/25 bg-accent-blue/5 px-3 py-2">
          <span className="text-xs text-ink-700">{selected.size} selected</span>
          <button
            onClick={() => render([...selected], "original")}
            disabled={busy || !r2Configured}
            className="rounded-lg border border-accent-blue/40 bg-accent-blue/5 px-2.5 py-1 text-xs text-accent-blue transition-colors duration-150 hover:bg-accent-blue/10 disabled:opacity-40"
          >
            {busy ? "Queuing…" : "Render onto original"}
          </button>
          <button
            onClick={() => render([...selected], "proxy")}
            disabled={busy || !r2Configured}
            className="btn-ghost h-7 px-2.5 text-xs"
          >
            Render onto proxy
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="text-[11px] text-ink-400 transition-colors duration-150 hover:text-ink-800"
          >
            Clear
          </button>
        </div>
      )}
      {msg && <p className="text-xs text-ink-500">{msg}</p>}

      {playing && (
        <div className="card p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs text-ink-500">
              {rows.find((r) => r.id === playing.id)?.clipTitle}
            </span>
            <button
              onClick={() => setPlaying(null)}
              className="text-xs text-ink-400 transition-colors duration-150 hover:text-ink-900"
            >
              Close ×
            </button>
          </div>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video src={playing.url} controls className="w-full rounded-lg bg-black" />
          <a
            href={playing.url}
            download
            className="mt-2 inline-block text-xs text-accent-blue hover:underline"
          >
            Download MP4 ↓
          </a>
        </div>
      )}

      <ul className="space-y-1">
        {shown.map((r) => {
          const status = r.overlayStatus;
          const flight = status === "queued" || status === "rendering";
          return (
            <li
              key={r.id}
              className={`flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                selected.has(r.id)
                  ? "border-accent-blue/40 bg-accent-blue/5"
                  : "border-ink-900/10"
              }`}
            >
              <input
                type="checkbox"
                checked={selected.has(r.id)}
                onChange={() => toggle(r.id)}
                disabled={!r.exportR2Key}
                title={
                  r.exportR2Key
                    ? "Select for rendering"
                    : "Not published yet — publish the batch first"
                }
                className="h-3.5 w-3.5 shrink-0 accent-accent-blue disabled:opacity-25"
              />
              <span className="text-ink-400">{r.isSession ? "🎬" : "▶"}</span>
              <span className="min-w-0 flex-1 truncate text-ink-800" title={r.clipTitle}>
                {r.clipTitle}
                <span className="ml-2 text-xs text-ink-400">
                  {r.project} · {r.batch} · {r.annotator}
                </span>
              </span>

              <span
                title={r.overlayError ?? undefined}
                className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${
                  status === "ready"
                    ? "bg-accent-green/10 text-accent-green"
                    : status === "failed"
                      ? "bg-accent-red/10 text-accent-red"
                      : flight
                        ? "bg-accent-blue/10 text-accent-blue"
                        : "bg-ink-900/5 text-ink-500"
                }`}
              >
                {flight && (
                  <span className="mr-1 inline-block h-2.5 w-2.5 animate-spin rounded-full border-2 border-accent-blue border-t-transparent align-[-1px]" />
                )}
                {status === "ready" ? `ready · ${r.overlaySource}` : status}
              </span>

              {status === "ready" && r.overlayR2Key && (
                <button
                  onClick={() => play(r.id)}
                  className="shrink-0 text-xs text-accent-blue transition-colors duration-150 hover:underline"
                >
                  Play ▸
                </button>
              )}
              {/* Live overlay on the source video — the same viewer the Review
                  tab links to. Available immediately, with no render: the labels
                  are drawn over the streamed video in the browser. */}
              <a
                href={`/overlay.html?assignment=${r.id}${r.hasOriginal ? "&source=original" : ""}`}
                target="_blank"
                rel="noreferrer"
                title={
                  r.hasOriginal
                    ? "Play the ORIGINAL upload with the labels drawn live — no render, available now"
                    : "Play the source video with the labels drawn live (no render needed)"
                }
                className="shrink-0 text-xs text-ink-400 transition-colors duration-150 hover:text-ink-900"
              >
                Live ↗
              </a>
              <button
                onClick={() => render([r.id], r.hasOriginal ? "original" : "proxy")}
                // Deliberately NOT disabled while in flight: a worker killed
                // mid-render leaves the row stuck on "rendering" forever, and
                // disabling the only button that could recover it was how the
                // job became unrecoverable in the first place.
                disabled={busy || !r2Configured || !r.exportR2Key}
                title={
                  !r.exportR2Key
                    ? "Publish the assignment first"
                    : flight
                      ? "Stuck? Queue it again — safe even if a worker is still on it."
                      : "Render (or re-render) this overlay"
                }
                className="shrink-0 text-xs text-ink-400 transition-colors duration-150 hover:text-ink-900 disabled:opacity-30"
              >
                {flight ? "Re-queue" : status === "ready" ? "Re-render" : "Render"}
              </button>
            </li>
          );
        })}
      </ul>

      {shown.length === 0 && (
        <p className="py-6 text-center text-xs text-ink-400">
          Nothing {filter} right now.
        </p>
      )}
    </div>
  );
}
