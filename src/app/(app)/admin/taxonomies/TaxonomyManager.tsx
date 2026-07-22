"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { TAXONOMY_TYPES, TAXONOMY_LABELS, type TaxonomyType } from "@/lib/kosha";

type Item = { id: string; value: string; active: boolean };
type Grouped = Record<string, Item[]>;

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

export default function TaxonomyManager({ grouped }: { grouped: Grouped }) {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {TAXONOMY_TYPES.map((type) => (
        <ListColumn key={type} type={type} items={grouped[type] ?? []} />
      ))}
    </div>
  );
}

function ListColumn({ type, items }: { type: TaxonomyType; items: Item[] }) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!value.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await api("/api/admin/taxonomy", "POST", { type, value });
      setValue("");
      router.refresh();
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    try {
      await api(`/api/admin/taxonomy/${id}`, "DELETE");
      router.refresh();
    } catch (e) {
      alert((e as Error).message);
    }
  }

  async function toggle(id: string, active: boolean) {
    try {
      await api(`/api/admin/taxonomy/${id}`, "PATCH", { active: !active });
      router.refresh();
    } catch (e) {
      alert((e as Error).message);
    }
  }

  return (
    <div className="card p-4">
      <h2 className="mb-1 text-sm font-semibold text-white">
        {TAXONOMY_LABELS[type]}
      </h2>
      <div className="mb-3 text-xs text-slate-500">{items.length} values</div>

      <ul className="mb-3 space-y-1">
        {items.map((it) => (
          <li
            key={it.id}
            className="flex items-center gap-2 rounded border border-ink-700 px-2 py-1 text-sm"
          >
            <span className={it.active ? "text-slate-200" : "text-slate-600 line-through"}>
              {it.value}
            </span>
            <button
              onClick={() => toggle(it.id, it.active)}
              className="ml-auto text-xs text-slate-500 hover:text-slate-300"
              title={it.active ? "Disable" : "Enable"}
            >
              {it.active ? "on" : "off"}
            </button>
            <button
              onClick={() => remove(it.id)}
              className="text-xs text-red-400 hover:text-red-300"
            >
              ✕
            </button>
          </li>
        ))}
        {items.length === 0 && (
          <li className="text-xs text-slate-500">No values yet.</li>
        )}
      </ul>

      <form onSubmit={add} className="flex gap-2">
        <input
          className="input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Add value…"
        />
        <button className="btn-primary px-3" disabled={busy}>
          +
        </button>
      </form>
      {err && <p className="mt-1 text-xs text-red-400">{err}</p>}
    </div>
  );
}
