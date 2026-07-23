"use client";

// Slim collapsible queue of the annotator's clips for one-click switching.
// Server-fetched in the annotate page and passed down; the current clip is
// highlighted with the selected-state idiom (accent-blue/60 + accent-blue/5).

import { useEffect, useState } from "react";
import Link from "next/link";
import StatusBadge from "@/components/StatusBadge";
import type { ClipListItem } from "./shared";

function fmtDuration(c: ClipListItem): string {
  const sec =
    c.durationSec ?? (c.frameCount != null && c.fps > 0 ? c.frameCount / c.fps : null);
  if (sec == null) return "";
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export default function ClipsSidebar({
  clips,
  currentId,
}: {
  clips: ClipListItem[];
  currentId: string;
}) {
  const [open, setOpen] = useState(true);

  // Per-browser preference, like kosha.windowSec.
  useEffect(() => {
    const saved = window.localStorage.getItem("kosha.clipsOpen");
    if (saved != null) setOpen(saved === "1");
  }, []);
  const toggle = () =>
    setOpen((o) => {
      window.localStorage.setItem("kosha.clipsOpen", o ? "0" : "1");
      return !o;
    });

  return (
    <aside className="sticky top-4 hidden max-h-[calc(100vh-6rem)] shrink-0 lg:block">
      {open ? (
        <div className="flex h-full w-60 flex-col">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-500">
              Clips ({clips.length})
            </span>
            <button
              onClick={toggle}
              title="Collapse clip list"
              className="btn-plain h-6 px-1.5 text-xs text-ink-500"
            >
              ⟨
            </button>
          </div>
          <nav className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1">
            {clips.map((c) => {
              const cur = c.assignmentId === currentId;
              return (
                <Link
                  key={c.assignmentId}
                  href={`/annotate/${c.assignmentId}`}
                  aria-current={cur ? "page" : undefined}
                  className={`block rounded-lg border p-2 transition-colors duration-150 ${
                    cur
                      ? "border-accent-blue/60 bg-accent-blue/5"
                      : "border-ink-900/10 hover:border-ink-900/20 hover:bg-ink-900/[0.03]"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <div className="grid h-8 w-12 shrink-0 place-items-center rounded-md bg-paper-100 text-[10px] text-ink-400">
                      ▶
                    </div>
                    <div className="min-w-0">
                      <div className={`truncate text-xs ${cur ? "text-ink-900" : "text-ink-800"}`}>
                        {c.title}
                      </div>
                      <div className="truncate text-[10px] text-ink-400">
                        {c.projectName} · {c.batchName}
                      </div>
                    </div>
                  </div>
                  <div className="mt-1.5 flex items-center justify-between">
                    <StatusBadge status={c.status} />
                    <span className="font-mono text-[10px] tabular-nums text-ink-500">
                      {fmtDuration(c)}
                    </span>
                  </div>
                </Link>
              );
            })}
          </nav>
        </div>
      ) : (
        <button
          onClick={toggle}
          title={`Show clip list (${clips.length})`}
          className="btn-ghost h-9 w-9 px-0"
        >
          ⟩
        </button>
      )}
    </aside>
  );
}
