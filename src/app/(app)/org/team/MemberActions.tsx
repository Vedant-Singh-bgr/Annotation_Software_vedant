"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Deactivate / reactivate a team member (soft — preserves their work).
export default function MemberActions({
  userId,
  active,
  isSelf,
}: {
  userId: string;
  active: boolean;
  isSelf: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (isSelf) return null; // can't deactivate yourself

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
    <div className="text-right">
      <button
        onClick={toggle}
        disabled={busy}
        className={`text-xs hover:underline disabled:opacity-50 ${
          active ? "text-red-400" : "text-green-400"
        }`}
      >
        {busy ? "…" : active ? "Deactivate" : "Reactivate"}
      </button>
      {err && <div className="text-[11px] text-red-400">{err}</div>}
    </div>
  );
}
