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
      <h1 className="mb-1 font-serif text-2xl font-medium text-ink-900">Assignments</h1>
      <p className="mb-6 text-sm text-ink-500">
        Assign clips from your projects to annotators on your team.
      </p>

      {err && (
        <p className="mb-4 rounded-lg border border-accent-red/25 bg-accent-red/5 px-3 py-2 text-sm text-accent-red">
          {err}
        </p>
      )}

      {projects.length === 0 && (
        <div className="card py-12 text-center text-sm text-ink-400">
          No projects assigned to your organization yet. The platform admin
          creates projects and imports clips.
        </div>
      )}

      <div className="space-y-6">
        {projects.map((p) => (
          <div key={p.id} className="card p-5">
            <h2 className="mb-3 text-sm font-medium text-ink-900">{p.name}</h2>
            {p.batches.every((b) => b.clips.length === 0) ? (
              <p className="text-xs text-ink-400">No clips imported yet.</p>
            ) : (
              <div className="space-y-4">
                {p.batches.map((b) =>
                  b.clips.length === 0 ? null : (
                    <div key={b.id}>
                      <div className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-500">
                        {b.name}
                      </div>
                      <div className="space-y-2">
                        {b.clips.map((c) => (
                          <div
                            key={c.id}
                            className="flex flex-wrap items-center gap-3 rounded-lg border border-ink-900/10 p-3 transition-colors duration-150 hover:bg-ink-900/[0.03]"
                          >
                            <span className="text-ink-400">▶</span>
                            <span className="min-w-0 flex-1 truncate text-sm text-ink-800">
                              {c.title}
                            </span>

                            <div className="flex flex-wrap items-center gap-1">
                              {c.assignments.length === 0 ? (
                                <span className="text-xs text-ink-400">
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
                                    className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs text-ink-700 transition-colors duration-150 hover:border-accent-blue/60 hover:text-ink-900 ${
                                      a.status === "SUBMITTED"
                                        ? "border-accent-yellow/30 bg-accent-yellow/10"
                                        : "border-transparent bg-ink-900/5"
                                    }`}
                                  >
                                    {a.annotator.name}
                                    <StatusBadge status={a.status} />
                                    {a.status === "SUBMITTED" && (
                                      <span className="text-accent-yellow">· Review →</span>
                                    )}
                                  </Link>
                                ))
                              )}
                            </div>

                            <div className="ml-auto flex items-center gap-2">
                              <select
                                className="rounded-lg border border-ink-900/15 bg-ink-900/[0.03] px-2 py-1 text-xs text-ink-900 transition-colors duration-150 focus:border-accent-blue/60 focus:outline-none"
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
