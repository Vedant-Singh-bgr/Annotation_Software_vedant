"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Org = { id: string; name: string };

export default function NewProjectForm({ orgs }: { orgs: Org[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [organizationId, setOrganizationId] = useState(orgs[0]?.id ?? "");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, organizationId, description }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setMsg({ ok: true, text: `Created “${data.project.name}”.` });
      setName("");
      setDescription("");
      router.refresh();
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card h-fit space-y-3 p-4">
      <h2 className="text-sm font-semibold text-white">New project</h2>
      <div>
        <label className="label">Organization</label>
        <select
          className="input"
          value={organizationId}
          onChange={(e) => setOrganizationId(e.target.value)}
          required
        >
          {orgs.length === 0 && <option value="">Create an org first</option>}
          {orgs.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="label">Project name</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
      <div>
        <label className="label">Description</label>
        <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      {msg && (
        <p className={`text-xs ${msg.ok ? "text-green-400" : "text-red-400"}`}>{msg.text}</p>
      )}
      <button type="submit" className="btn-primary w-full" disabled={busy || orgs.length === 0}>
        {busy ? "Creating…" : "Create project"}
      </button>
    </form>
  );
}
