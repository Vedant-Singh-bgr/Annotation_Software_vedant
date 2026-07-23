"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Deactivate / reactivate a team member (soft — preserves their work).
export default function MemberActions({
  userId,
  active,
  isSelf,
  role,
}: {
  userId: string;
  active: boolean;
  isSelf: boolean;
  role: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (isSelf) return null; // can't deactivate or re-role yourself

  // Move someone between annotating and reviewing. The server refuses to move
  // an annotator who still holds open work — it would be permanently
  // unsubmittable afterwards — and says which clips are blocking, so that
  // message is worth showing verbatim rather than summarising.
  async function changeRole(nextRole: string) {
    const label = nextRole === "QC" ? "QC reviewer" : "annotator";
    if (
      !confirm(
        `Change this member to ${label}?\n\n` +
          (nextRole === "QC"
            ? "They will stop being assignable for annotation and will review only the clips you route to them. Any open annotation work must be finished or reassigned first."
            : "They will stop reviewing, and any clips routed to them for review (other than already-approved ones) will be unrouted."),
      )
    )
      return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/org/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, role: nextRole }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function toggle() {
    const next = !active;
    if (
      next === false &&
      !confirm("Deactivate this member? They won't be able to sign in, but their annotations are kept. You can reactivate them anytime.")
    )
      return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/org/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, active: next }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-[220px] text-right">
      <div className="flex items-center justify-end gap-2">
        {(role === "ANNOTATOR" || role === "QC") && (
          <button
            onClick={() => changeRole(role === "ANNOTATOR" ? "QC" : "ANNOTATOR")}
            disabled={busy}
            title={
              role === "ANNOTATOR"
                ? "Make this person a QC reviewer"
                : "Move this person back to annotating"
            }
            className="text-xs text-ink-400 underline-offset-2 transition-colors duration-150 hover:text-ink-900 hover:underline disabled:opacity-50"
          >
            {role === "ANNOTATOR" ? "→ QC" : "→ Annotator"}
          </button>
        )}
        <button
          onClick={toggle}
          disabled={busy}
          className={`text-xs underline-offset-2 transition-colors duration-150 hover:underline disabled:opacity-50 ${
            active ? "text-accent-red" : "text-accent-green"
          }`}
        >
          {busy ? "…" : active ? "Deactivate" : "Reactivate"}
        </button>
      </div>
      {err && <div className="mt-1 text-[11px] leading-snug text-accent-red">{err}</div>}
    </div>
  );
}
