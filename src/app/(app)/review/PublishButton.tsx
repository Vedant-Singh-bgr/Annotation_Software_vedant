"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Publish (or re-publish) an assignment's export to R2, beside the clip's MP4.
// Approval does this automatically; this is the retry / re-cut path for reviewers
// after a fix, and the only way to publish work that is not APPROVED.
export default function PublishButton({
  assignmentId,
  exportR2Key,
  exportedAt,
  exportError,
}: {
  assignmentId: string;
  exportR2Key: string | null;
  exportedAt: string | null;
  exportError: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function publish() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/assignments/${assignmentId}/export`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Publish failed");
      router.refresh();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Failures are recorded on the assignment, so a stale error stays visible until
  // the next successful publish.
  const state = exportError
    ? { text: "publish failed", tone: "text-red-400", title: exportError }
    : exportR2Key
      ? {
          text: exportR2Key.split("/").slice(-2).join("/"),
          tone: "text-slate-500",
          title: `${exportR2Key}\npublished ${exportedAt ? new Date(exportedAt).toLocaleString() : "—"}`,
        }
      : { text: "not published", tone: "text-slate-600", title: "No export in R2 yet." };

  return (
    <div className="flex shrink-0 items-center gap-2">
      <span className={`max-w-[220px] truncate font-mono text-[11px] ${state.tone}`} title={state.title}>
        {msg ?? state.text}
      </span>
      <button
        onClick={publish}
        disabled={busy}
        className="rounded border border-ink-700 px-2 py-1 text-xs text-slate-300 hover:bg-ink-800 disabled:opacity-50"
        title="Write the export JSON to R2 next to the clip's MP4 proxy"
      >
        {busy ? "…" : exportR2Key ? "Re-publish" : "Publish"}
      </button>
    </div>
  );
}
