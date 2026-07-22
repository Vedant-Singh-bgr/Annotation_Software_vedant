"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import StatusBadge from "@/components/StatusBadge";

type Annotator = { id: string; name: string };
type Assignment = {
  id: string;
  status: string;
  annotator: { id: string; name: string };
};
type Clip = { id: string; title: string; assignments: Assignment[] };
type Batch = { id: string; name: string; clips: Clip[] };
type Project = { id: string; name: string; batches: Batch[] };

export default function AssignBoard({
  projects,
  annotators,
}: {
  projects: Project[];
  annotators: Annotator[];
}) {
  const router = useRouter();
  const [busyClip, setBusyClip] = useState<string | null>(null);
  const [pick, setPick] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);

  async function assign(clipId: string) {
    const annotatorId = pick[clipId] || annotators[0]?.id;
    if (!annotatorId) {
      setErr("Add an annotator to your team first.");
      return;
    }
    setBusyClip(clipId);
    setErr(null);
    try {
      const res = await fetch("/api/org/assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clipId, annotatorId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusyClip(null);
    }
  }

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-white">Assignments</h1>
      <p className="mb-6 text-sm text-slate-400">
        Assign clips from your projects to annotators on your team.
      </p>

      {err && (
        <p className="mb-4 rounded-md bg-red-950/50 px-3 py-2 text-sm text-red-300">
          {err}
        </p>
      )}

      {projects.length === 0 && (
        <div className="card p-8 text-center text-sm text-slate-500">
          No projects assigned to your organization yet. The platform admin
          creates projects and imports clips.
        </div>
      )}

      <div className="space-y-6">
        {projects.map((p) => (
          <div key={p.id} className="card p-4">
            <h2 className="mb-3 font-medium text-slate-100">{p.name}</h2>
            {p.batches.every((b) => b.clips.length === 0) ? (
              <p className="text-xs text-slate-500">No clips imported yet.</p>
            ) : (
              <div className="space-y-4">
                {p.batches.map((b) =>
                  b.clips.length === 0 ? null : (
                    <div key={b.id}>
                      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">
                        {b.name}
                      </div>
                      <div className="space-y-2">
                        {b.clips.map((c) => (
                          <div
                            key={c.id}
                            className="flex flex-wrap items-center gap-3 rounded-md border border-ink-700 p-3"
                          >
                            <span className="text-slate-500">▶</span>
                            <span className="min-w-0 flex-1 truncate text-sm text-slate-200">
                              {c.title}
                            </span>

                            <div className="flex flex-wrap items-center gap-1">
                              {c.assignments.length === 0 ? (
                                <span className="text-xs text-slate-500">
                                  Unassigned
                                </span>
                              ) : (
                                c.assignments.map((a) => (
                                  <Link
                                    key={a.id}
                                    href={`/annotate/${a.id}`}
                                    title={
                                      a.status === "SUBMITTED"
                                        ? "Open to review (approve / reject)"
                                        : "Open annotation"
                                    }
                                    className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs text-slate-300 hover:border-brand-500 hover:text-white ${
                                      a.status === "SUBMITTED"
                                        ? "border-amber-700/60 bg-amber-950/30"
                                        : "border-transparent bg-ink-800"
                                    }`}
                                  >
                                    {a.annotator.name}
                                    <StatusBadge status={a.status} />
                                    {a.status === "SUBMITTED" && (
                                      <span className="text-amber-300">· Review →</span>
                                    )}
                                  </Link>
                                ))
                              )}
                            </div>

                            <div className="ml-auto flex items-center gap-2">
                              <select
                                className="rounded-md border border-ink-600 bg-ink-800 px-2 py-1 text-xs text-slate-100"
                                value={pick[c.id] ?? ""}
                                onChange={(e) =>
                                  setPick((prev) => ({
                                    ...prev,
                                    [c.id]: e.target.value,
                                  }))
                                }
                              >
                                <option value="">
                                  {annotators.length
                                    ? "Choose annotator…"
                                    : "No annotators"}
                                </option>
                                {annotators.map((an) => (
                                  <option key={an.id} value={an.id}>
                                    {an.name}
                                  </option>
                                ))}
                              </select>
                              <button
                                onClick={() => assign(c.id)}
                                disabled={
                                  busyClip === c.id || annotators.length === 0
                                }
                                className="btn-primary px-3 py-1 text-xs"
                              >
                                {busyClip === c.id ? "…" : "Assign"}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ),
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
