"use client";

import { useState } from "react";
import { Task, Taxonomies, taskOverlaps } from "./shared";
import { DIFFICULTIES, TASK_QUALITY_FLAGS } from "@/lib/kosha";
import { taskDurationHint } from "@/lib/validate";

// Auto-flag raised when an annotator enters a taxonomy value that isn't on the
// approved list (job / venue_L2 / venue_L3). Reviewers clear it once vetted.
const TAXONOMY_REVIEW_FLAG = "needs_taxonomy_review";

export default function TasksPanel({
  tasks,
  selectedId,
  currentFrame,
  fps,
  editable,
  taxonomies,
  onSelect,
  onCreate,
  onUpdate,
  onDelete,
  onSeek,
}: {
  tasks: Task[];
  selectedId: string | null;
  currentFrame: number;
  fps: number;
  editable: boolean;
  taxonomies: Taxonomies;
  onSelect: (id: string) => void;
  onCreate: (fill?: boolean) => void;
  onUpdate: (id: string, patch: Partial<Task>) => void;
  onDelete: (id: string) => void;
  onSeek: (frame: number) => void;
}) {
  const selected = tasks.find((t) => t.id === selectedId) ?? null;
  const overlaps = taskOverlaps(tasks);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">
          L1 Tasks ({tasks.length})
        </h3>
        {editable && (
          <div className="flex gap-1">
            {tasks.length >= 2 && (
              <button
                onClick={() => onCreate(true)}
                title="Create a task filling the first gap between existing tasks (unlabeled)"
                className="btn-ghost px-2 py-1 text-xs"
              >
                + fill gap
              </button>
            )}
            <button onClick={() => onCreate()} className="btn-primary px-3 py-1 text-xs">
              + New task at playhead
            </button>
          </div>
        )}
      </div>

      {overlaps.length > 0 && (
        <div className="rounded-md border border-red-800/60 bg-red-950/30 px-3 py-2 text-xs text-red-300">
          <div className="font-medium">
            ⚠ {overlaps.length} overlapping task{overlaps.length > 1 ? "s" : ""} — L1
            tasks must not overlap (leave a gap between them).
          </div>
          <ul className="mt-1 space-y-0.5 text-red-400/90">
            {overlaps.slice(0, 4).map((o, i) => (
              <li key={i} className="font-mono text-[11px]">
                {(o.a.label || "task")} [{o.a.startFrame}–{o.a.endFrame}] ∩{" "}
                {(o.b.label || "task")} [{o.b.startFrame}–{o.b.endFrame}] · {o.frames}f
              </li>
            ))}
          </ul>
        </div>
      )}

      {tasks.length === 0 ? (
        <p className="rounded-md border border-ink-700 p-4 text-center text-xs text-slate-500">
          No tasks yet. Position the playhead at a task start and click “New task”.
        </p>
      ) : (
        <ul className="space-y-1">
          {tasks.map((t) => (
            <li key={t.id}>
              <div
                className={`flex items-center gap-2 rounded-md border px-2 py-1 text-sm ${
                  selectedId === t.id
                    ? "border-brand-500 bg-ink-800"
                    : "border-ink-700 hover:bg-ink-800"
                }`}
              >
                {/* The label IS the input — type the task name right here. */}
                <input
                  className="min-w-0 flex-1 bg-transparent py-0.5 text-slate-100 placeholder:text-slate-500 focus:outline-none disabled:cursor-default"
                  value={t.label}
                  placeholder="type task_label (verb_noun)…"
                  disabled={!editable}
                  onFocus={() => onSelect(t.id)}
                  onChange={(e) => onUpdate(t.id, { label: e.target.value })}
                />
                {(() => {
                  const hint = taskDurationHint(t.endFrame - t.startFrame, fps);
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
                    onSelect(t.id);
                    onSeek(t.startFrame);
                  }}
                  title="Go to task start frame"
                  className={`shrink-0 font-mono text-[11px] text-slate-500 hover:text-brand-400 ${
                    taskDurationHint(t.endFrame - t.startFrame, fps) ? "" : "ml-auto"
                  }`}
                >
                  {t.startFrame}–{t.endFrame}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {selected && (
        <TaskEditor
          key={selected.id}
          task={selected}
          editable={editable}
          currentFrame={currentFrame}
          taxonomies={taxonomies}
          onUpdate={(patch) => onUpdate(selected.id, patch)}
          onDelete={() => onDelete(selected.id)}
        />
      )}
    </div>
  );
}

function TaskEditor({
  task,
  editable,
  currentFrame,
  taxonomies,
  onUpdate,
  onDelete,
}: {
  task: Task;
  editable: boolean;
  currentFrame: number;
  taxonomies: Taxonomies;
  onUpdate: (patch: Partial<Task>) => void;
  onDelete: () => void;
}) {
  const dis = !editable;

  function toggleFlag(flag: string) {
    const has = task.qualityFlags.includes(flag);
    const next = has
      ? task.qualityFlags.filter((f) => f !== flag)
      : [...task.qualityFlags, flag];
    onUpdate({ qualityFlags: next });
  }

  const isCustom = (val: string, opts: string[]) => !!val && !opts.includes(val);

  // Update a taxonomy field AND recompute the needs_taxonomy_review flag: if any
  // of job/venue_L2/venue_L3 holds an off-list (custom) value, the flag is on;
  // when all three are back on the approved list, it's cleared automatically.
  function updateTaxonomy(patch: Partial<Task>) {
    const next = { ...task, ...patch };
    const anyCustom =
      isCustom(next.job, taxonomies.JOB) ||
      isCustom(next.venueL2, taxonomies.VENUE_L2) ||
      isCustom(next.venueL3, taxonomies.VENUE_L3);
    const has = task.qualityFlags.includes(TAXONOMY_REVIEW_FLAG);
    let flags = task.qualityFlags;
    if (anyCustom && !has) flags = [...flags, TAXONOMY_REVIEW_FLAG];
    else if (!anyCustom && has) flags = flags.filter((f) => f !== TAXONOMY_REVIEW_FLAG);
    onUpdate({ ...patch, qualityFlags: flags });
  }

  return (
    <div className="space-y-3 rounded-md border border-ink-700 bg-ink-900 p-3">
      <div className="grid grid-cols-2 gap-2">
        <FrameField
          label="start_frame"
          value={task.startFrame}
          disabled={dis}
          onChange={(v) => onUpdate({ startFrame: v })}
          onPlayhead={() => onUpdate({ startFrame: currentFrame })}
        />
        <FrameField
          label="end_frame"
          value={task.endFrame}
          disabled={dis}
          onChange={(v) => onUpdate({ endFrame: v })}
          onPlayhead={() => onUpdate({ endFrame: currentFrame })}
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Field label="difficulty">
          <select
            className="input"
            disabled={dis}
            value={task.difficulty}
            onChange={(e) => onUpdate({ difficulty: e.target.value })}
          >
            <option value="">—</option>
            {DIFFICULTIES.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </Field>
        <Field label="job">
          <TaxSelect
            disabled={dis}
            value={task.job}
            options={taxonomies.JOB}
            onChange={(v) => updateTaxonomy({ job: v })}
          />
        </Field>
        <Field label="venue_L2">
          <TaxSelect
            disabled={dis}
            value={task.venueL2}
            options={taxonomies.VENUE_L2}
            onChange={(v) => updateTaxonomy({ venueL2: v })}
          />
        </Field>
        <Field label="venue_L3">
          <TaxSelect
            disabled={dis}
            value={task.venueL3}
            options={taxonomies.VENUE_L3}
            onChange={(v) => updateTaxonomy({ venueL3: v })}
          />
        </Field>
      </div>

      <Field label="task_confidence (0–1)">
        <input
          className="input"
          type="number"
          min={0}
          max={1}
          step={0.05}
          disabled={dis}
          value={task.confidence ?? ""}
          onChange={(e) =>
            onUpdate({ confidence: e.target.value === "" ? null : Number(e.target.value) })
          }
        />
      </Field>

      <div>
        <div className="label">quality_flags</div>
        <div className="flex flex-wrap gap-1">
          {TASK_QUALITY_FLAGS.map((f) => {
            const on = task.qualityFlags.includes(f);
            return (
              <button
                key={f}
                disabled={dis}
                onClick={() => toggleFlag(f)}
                className={`rounded-full px-2 py-0.5 text-[11px] ${
                  on
                    ? "bg-amber-900/50 text-amber-300"
                    : "bg-ink-800 text-slate-400 hover:bg-ink-700"
                }`}
              >
                {f}
              </button>
            );
          })}
        </div>
      </div>

      <Field label="notes">
        <textarea
          className="input min-h-[54px]"
          disabled={dis}
          value={task.notes}
          onChange={(e) => onUpdate({ notes: e.target.value })}
        />
      </Field>

      {editable && (
        <button onClick={onDelete} className="btn-danger w-full py-1 text-xs">
          Delete task
        </button>
      )}
    </div>
  );
}

const CUSTOM_OPTION = "__custom__";

function TaxSelect({
  value,
  options,
  disabled,
  onChange,
}: {
  value: string;
  options: string[];
  disabled: boolean;
  onChange: (v: string) => void;
}) {
  // A non-empty value that isn't on the approved list is a custom entry.
  const valueIsCustom = !!value && !options.includes(value);
  const [customMode, setCustomMode] = useState(valueIsCustom);
  const showCustomInput = customMode || valueIsCustom;

  return (
    <div className="space-y-1">
      <select
        className="input"
        disabled={disabled}
        value={valueIsCustom ? CUSTOM_OPTION : value}
        onChange={(e) => {
          if (e.target.value === CUSTOM_OPTION) {
            setCustomMode(true);
            // keep an existing custom value; otherwise start blank for typing
            onChange(valueIsCustom ? value : "");
          } else {
            setCustomMode(false);
            onChange(e.target.value);
          }
        }}
      >
        <option value="">—</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
        <option value={CUSTOM_OPTION}>＋ Enter custom…</option>
      </select>

      {showCustomInput && (
        <input
          className="input text-amber-200"
          disabled={disabled}
          value={value}
          autoFocus
          placeholder="type a value not on the list…"
          onChange={(e) => onChange(e.target.value)}
          title="Custom value — this task will be flagged needs_taxonomy_review"
        />
      )}
    </div>
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="label">{label}</div>
      {children}
    </div>
  );
}

export function FrameField({
  label,
  value,
  disabled,
  onChange,
  onPlayhead,
}: {
  label: string;
  value: number;
  disabled: boolean;
  onChange: (v: number) => void;
  onPlayhead: () => void;
}) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className="flex gap-1">
        <input
          className="input font-mono"
          type="number"
          disabled={disabled}
          value={value}
          onChange={(e) => onChange(Math.round(Number(e.target.value)))}
        />
        <button
          type="button"
          disabled={disabled}
          onClick={onPlayhead}
          title="Set to playhead"
          className="btn-ghost shrink-0 px-2 text-xs"
        >
          ⇥
        </button>
      </div>
    </div>
  );
}
