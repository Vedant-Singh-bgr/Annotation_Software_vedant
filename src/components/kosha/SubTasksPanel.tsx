"use client";

import { Task, SubTask, coverage } from "./shared";
import { Field, FrameField } from "./TasksPanel";
import { subTaskDurationHint } from "@/lib/validate";

export default function SubTasksPanel({
  task,
  currentFrame,
  fps,
  editable,
  onCreate,
  onUpdate,
  onDelete,
  onSeek,
  selectedSubId,
  onSelectSub,
}: {
  task: Task | null;
  currentFrame: number;
  fps: number;
  editable: boolean;
  onCreate: (label?: string, fill?: boolean) => void;
  onUpdate: (id: string, patch: Partial<SubTask>) => void;
  onDelete: (id: string) => void;
  onSeek: (frame: number) => void;
  selectedSubId: string | null;
  onSelectSub: (id: string) => void;
}) {
  if (!task) {
    return (
      <p className="rounded-md border border-ink-700 p-4 text-center text-xs text-slate-500">
        Select an L1 task first, then tile it with sub-tasks.
      </p>
    );
  }

  const cov = coverage(task);
  const span = Math.max(1, task.endFrame - task.startFrame);
  const selected = task.subTasks.find((s) => s.id === selectedSubId) ?? null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">
          L2 Sub-tasks ({task.subTasks.length})
        </h3>
        {editable && (
          <div className="flex gap-1">
            <button
              onClick={() => onCreate("idle_wait", true)}
              title="Fill the remaining gap with an idle_wait sub-task (for pauses inside the task)"
              className="btn-ghost px-2 py-1 text-xs"
            >
              + idle_wait
            </button>
            <button onClick={() => onCreate()} className="btn-primary px-3 py-1 text-xs">
              + Sub-task
            </button>
          </div>
        )}
      </div>

      {/* coverage bar */}
      <div>
        <div className="relative h-6 overflow-hidden rounded border border-ink-700 bg-ink-950">
          {task.subTasks.map((s) => {
            const left = ((s.startFrame - task.startFrame) / span) * 100;
            const width = ((s.endFrame - s.startFrame) / span) * 100;
            return (
              <div
                key={s.id}
                className={`absolute top-0 bottom-0 border-r border-black/40 ${
                  selectedSubId === s.id ? "bg-brand-500/70" : "bg-brand-600/40"
                }`}
                style={{ left: `${left}%`, width: `${Math.max(width, 0.5)}%` }}
              />
            );
          })}
          {cov.gaps.map(([g0, g1], i) => {
            const left = ((g0 - task.startFrame) / span) * 100;
            const width = ((g1 - g0) / span) * 100;
            return (
              <div
                key={`gap-${i}`}
                className="absolute top-0 bottom-0 bg-red-600/40"
                style={{ left: `${left}%`, width: `${Math.max(width, 0.5)}%` }}
                title={`gap ${g0}–${g1}`}
              />
            );
          })}
        </div>
        <div className="mt-1 flex items-center gap-3 text-[11px]">
          <span className={cov.pct === 100 ? "text-green-400" : "text-amber-400"}>
            {cov.pct}% covered
          </span>
          <span className="text-red-400">{cov.gaps.length} gaps</span>
          {cov.overlaps > 0 && (
            <span className="text-red-400">{cov.overlaps}f overlap</span>
          )}
          {cov.pct === 100 && cov.overlaps === 0 && (
            <span className="text-green-400">✓ fully tiled</span>
          )}
        </div>
      </div>

      {task.subTasks.length === 0 ? (
        <p className="text-center text-xs text-slate-500">
          No sub-tasks yet. They must tile the task with no gaps/overlaps.
        </p>
      ) : (
        <ul className="space-y-1">
          {task.subTasks.map((s) => (
            <li key={s.id}>
              <div
                className={`flex items-center gap-2 rounded-md border px-2 py-1 text-sm ${
                  selectedSubId === s.id
                    ? "border-brand-500 bg-ink-800"
                    : "border-ink-700 hover:bg-ink-800"
                }`}
              >
                <input
                  className="min-w-0 flex-1 bg-transparent py-0.5 text-slate-100 placeholder:text-slate-500 focus:outline-none disabled:cursor-default"
                  value={s.label}
                  placeholder="type action_label (snake_case)…"
                  disabled={!editable}
                  onFocus={() => onSelectSub(s.id)}
                  onChange={(e) => onUpdate(s.id, { label: e.target.value })}
                />
                {(() => {
                  const hint = subTaskDurationHint(s.endFrame - s.startFrame, fps, s.label);
                  return hint ? (
                    <span
                      title={`Duration ${hint}`}
                      className="ml-auto shrink-0 rounded bg-amber-900/40 px-1.5 py-0.5 text-[10px] text-amber-300"
                    >
                      ⏱ {hint.split(" · ")[0]}
                    </span>
                  ) : null;
                })()}
                <button
                  type="button"
                  onClick={() => {
                    onSelectSub(s.id);
                    onSeek(s.startFrame);
                  }}
                  title="Go to sub-task start frame"
                  className={`shrink-0 font-mono text-[11px] text-slate-500 hover:text-brand-400 ${
                    subTaskDurationHint(s.endFrame - s.startFrame, fps, s.label) ? "" : "ml-auto"
                  }`}
                >
                  {s.startFrame}–{s.endFrame}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {selected && (
        <SubTaskEditor
          key={selected.id}
          sub={selected}
          editable={editable}
          currentFrame={currentFrame}
          onUpdate={(patch) => onUpdate(selected.id, patch)}
          onDelete={() => onDelete(selected.id)}
        />
      )}
    </div>
  );
}

function SubTaskEditor({
  sub,
  editable,
  currentFrame,
  onUpdate,
  onDelete,
}: {
  sub: SubTask;
  editable: boolean;
  currentFrame: number;
  onUpdate: (patch: Partial<SubTask>) => void;
  onDelete: () => void;
}) {
  const dis = !editable;
  return (
    <div className="space-y-3 rounded-md border border-ink-700 bg-ink-900 p-3">
      <div className="grid grid-cols-2 gap-2">
        <FrameField
          label="start_frame"
          value={sub.startFrame}
          disabled={dis}
          onChange={(v) => onUpdate({ startFrame: v })}
          onPlayhead={() => onUpdate({ startFrame: currentFrame })}
        />
        <FrameField
          label="end_frame"
          value={sub.endFrame}
          disabled={dis}
          onChange={(v) => onUpdate({ endFrame: v })}
          onPlayhead={() => onUpdate({ endFrame: currentFrame })}
        />
      </div>

      <Field label="description (overall / left hand / right hand)">
        <textarea
          className="input min-h-[70px]"
          disabled={dis}
          value={sub.description}
          placeholder="operator stands at the cutting board, left hand pins the onion steady, right hand rocks the knife down through it"
          onChange={(e) => onUpdate({ description: e.target.value })}
        />
      </Field>

      <div className="grid grid-cols-2 gap-2">
        <Field label="object_left">
          <input
            className="input"
            disabled={dis}
            value={sub.objectLeft}
            onChange={(e) => onUpdate({ objectLeft: e.target.value })}
          />
        </Field>
        <Field label="object_right">
          <input
            className="input"
            disabled={dis}
            value={sub.objectRight}
            onChange={(e) => onUpdate({ objectRight: e.target.value })}
          />
        </Field>
      </div>

      <Field label="confidence (0–1)">
        <input
          className="input"
          type="number"
          min={0}
          max={1}
          step={0.05}
          disabled={dis}
          value={sub.confidence ?? ""}
          onChange={(e) =>
            onUpdate({ confidence: e.target.value === "" ? null : Number(e.target.value) })
          }
        />
      </Field>

      {editable && (
        <button onClick={onDelete} className="btn-danger w-full py-1 text-xs">
          Delete sub-task
        </button>
      )}
    </div>
  );
}
