"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function NewMemberForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("ANNOTATOR");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/org/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password, role }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setMsg({ ok: true, text: `Added ${data.user.email}.` });
      setName("");
      setEmail("");
      setPassword("");
      router.refresh();
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card h-fit space-y-4 p-5">
      <h2 className="text-sm font-medium text-ink-900">Add team member</h2>
      <div>
        <label className="label">Name</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div>
        <label className="label">Email</label>
        <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </div>
      <div>
        <label className="label">Password (8+ chars)</label>
        <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </div>
      <div>
        <label className="label">Role</label>
        <select className="input" value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="ANNOTATOR">Annotator</option>
          <option value="QC">QC reviewer</option>
          <option value="ORG_ADMIN">Org admin</option>
        </select>
        <p className="mt-1 text-[11px] text-ink-400">
          {role === "QC"
            ? "Reviews only the clips you route to them, and approves or rejects — they cannot edit annotations."
            : role === "ORG_ADMIN"
              ? "Full access to this organization: every project, clip and review."
              : "Annotates the clips you assign to them."}
        </p>
      </div>
      {msg && (
        <p className={`text-xs ${msg.ok ? "text-accent-green" : "text-accent-red"}`}>{msg.text}</p>
      )}
      <button type="submit" className="btn-primary w-full" disabled={busy}>
        {busy ? "Adding…" : "Add member"}
      </button>
    </form>
  );
}
