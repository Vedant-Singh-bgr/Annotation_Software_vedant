"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function NewOrgForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/organizations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, adminName, adminEmail, adminPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setMsg({ ok: true, text: `Created “${data.organization.name}”.` });
      setName("");
      setAdminName("");
      setAdminEmail("");
      setAdminPassword("");
      router.refresh();
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card h-fit space-y-3 p-4">
      <h2 className="text-sm font-semibold text-white">New organization</h2>
      <div>
        <label className="label">Company name</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
      <div className="border-t border-ink-700 pt-3">
        <p className="mb-2 text-xs text-slate-500">
          Optional: create their first org admin.
        </p>
        <div className="space-y-2">
          <input className="input" placeholder="Admin name" value={adminName} onChange={(e) => setAdminName(e.target.value)} />
          <input className="input" type="email" placeholder="Admin email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} />
          <input className="input" type="password" placeholder="Admin password (8+ chars)" value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} />
        </div>
      </div>
      {msg && (
        <p className={`text-xs ${msg.ok ? "text-green-400" : "text-red-400"}`}>{msg.text}</p>
      )}
      <button type="submit" className="btn-primary w-full" disabled={busy}>
        {busy ? "Creating…" : "Create organization"}
      </button>
    </form>
  );
}
