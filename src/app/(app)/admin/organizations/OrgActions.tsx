"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Archive / restore an organization (soft — preserves all its data, but locks
// out every user in it while archived).
export default function OrgActions({
  orgId,
  active,
}: {
  orgId: string;
  active: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function toggle() {
    const next = !active;
    if (
      next === false &&
      !confirm("Archive this organization? All of its users will be locked out (they can't sign in), but every project, clip, and annotation is preserved. You can restore it anytime.")
    )
      return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/admin/organizations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, active: next }),
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
    <div className="text-right">
      <button
        onClick={toggle}
        disabled={busy}
        className={`text-xs hover:underline disabled:opacity-50 ${
          active ? "text-red-400" : "text-green-400"
        }`}
      >
        {busy ? "…" : active ? "Archive" : "Restore"}
      </button>
      {err && <div className="text-[11px] text-red-400">{err}</div>}
    </div>
  );
}
