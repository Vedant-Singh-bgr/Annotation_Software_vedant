"use client";

// Drill-down annotations panel with two swappable views:
//   list   — collapsible outline of L1 tasks with nested L2 sub-tasks. Single
//            click selects (and seeks, syncing the timeline); double-click or
//            the "Edit" affordance drills into the editor.
//   editor — the whole panel becomes the selected item's detail form, with a
//            "‹ All tasks" back button. A task's sub-tasks live at the TOP of
//            its editor (mini rows + coverage + add actions); clicking one
//            swaps to that sub-task's editor.
// Timeline block clicks land directly in the editor view (wired upstream).

import { useState } from "react";
import { Task, SubTask, Taxonomies, taskOverlaps, coverage } from "./shared";
import { DIFFICULTIES, TASK_QUALITY_FLAGS } from "@/lib/kosha";
import { taskDurationHint, subTaskDurationHint } from "@/lib/validate";

// Auto-flag raised when an annotator enters a taxonomy value that isn't on the
// approved list (job / venue L2 / venue L3). Reviewers clear it once vetted.
const TAXONOMY_REVIEW_FLAG = "needs_taxonomy_review";

type Props = {
  tasks: Task[];
  selectedTaskId: string | null;
  selectedSubId: string | null;
  currentFrame: number;
  fps: number;
  editable: boolean;
  view: "list" | "editor";
  onOpenEditor: () => void;
  onBackToList: () => void;
  taxonomies: Taxonomies;
  onSelectTask: (id: string) => void; // also clears any sub selection
  onSelectSub: (taskId: string, subId: string) => void;
  onCreateTask: (fill?: boolean) => void;
  onUpdateTask: (id: string, patch: Partial<Task>) => void;
  onDeleteTask: (id: string) => void;
  onCreateSub: (label?: string, fill?: boolean) => void; // acts on selected task
  onUpdateSub: (id: string, patch: Partial<SubTask>) => void;
  onDeleteSub: (id: string) => void;
  onSeek: (frame: number) => void;
};

export default function AnnotationsPanel(props: Props) {
  const { tasks, selectedTaskId, selectedSubId, view } = props;

  const selectedTask = tasks.find((t) => t.id === selectedTaskId) ?? null;
  const selectedSub =
    selectedTask?.subTasks.find((s) => s.id === selectedSubId) ?? null;

  // Fall back to the list when the selection vanishes (e.g. after a delete).
  const showEditor = view === "editor" && selectedTask !== null;

  return showEditor ? (
    <EditorView {...props} task={selectedTask!} sub={selectedSub} />
  ) : (
    <ListView {...props} />
  );
}

// ── list view ───────────────────────────────────────────────────────────────

function ListView({
  tasks,
  selectedTaskId,
  selectedSubId,
  fps,
  editable,
  onOpenEditor,
  onSelectTask,
  onSelectSub,
  onCreateTask,
  onSeek,
}: Props) {
  const overlaps = taskOverlaps(tasks);
  const dur = (frames: number) => (fps > 0 ? (frames / fps).toFixed(1) : "–");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  function toggleCollapsed(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-ink-900">
          Tasks <span className="text-ink-400">({tasks.length})</span>
        </h3>
        {editable && (
          <div className="flex items-center gap-1.5">
            {tasks.length >= 2 && (
              <button
                onClick={() => onCreateTask(true)}
                title="Add a task filling the first gap between existing tasks"
                className="btn-ghost h-7 px-2 text-xs"
              >
                + Fill gap
              </button>
            )}
            <button
              onClick={() => onCreateTask()}
              title="Creates at the playhead and opens its editor"
              className="btn-primary h-7 px-3 text-xs"
            >
              + New task
            </button>
          </div>
        )}
      </div>

      {overlaps.length > 0 && (
        <p className="flex gap-2 text-sm leading-snug text-ink-700">
          <span className="w-3 shrink-0 text-center text-accent-red">×</span>
          <span>
            Tasks must not overlap
            <span className="ml-1 font-mono text-xs tabular-nums text-ink-500">
              ({overlaps
                .slice(0, 2)
                .map((o) => `${o.a.startFrame}–${o.a.endFrame} ∩ ${o.b.startFrame}–${o.b.endFrame}`)
                .join(", ")}
              {overlaps.length > 2 ? ", …" : ""})
            </span>
          </span>
        </p>
      )}

      {tasks.length === 0 ? (
        <p className="py-6 text-center text-sm text-ink-500">
          No tasks yet — position the playhead and click “+ New task”.
        </p>
      ) : (
        <ul className="max-h-[52vh] space-y-0.5 overflow-y-auto pr-1">
          {tasks.map((t) => {
            const selTask = selectedTaskId === t.id && !selectedSubId;
            const isCollapsed = collapsed.has(t.id);
            const tHint = taskDurationHint(t.endFrame - t.startFrame, fps);
            return (
              <li key={t.id}>
                <div
                  onClick={() => {
                    onSelectTask(t.id);
                    onSeek(t.startFrame);
                  }}
                  onDoubleClick={() => {
                    onSelectTask(t.id);
                    onOpenEditor();
                  }}
                  className={`group flex cursor-pointer items-center gap-1.5 rounded-r-md border-l-2 px-1.5 py-2 transition-colors duration-150 ${
                    selTask
                      ? "border-accent-blue bg-accent-blue/5"
                      : "border-transparent hover:bg-ink-900/[0.03]"
                  }`}
                >
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleCollapsed(t.id);
                    }}
                    title={isCollapsed ? "Show sub-tasks" : "Hide sub-tasks"}
                    className={`w-4 shrink-0 text-center text-[10px] text-ink-400 transition-transform duration-150 hover:text-ink-800 ${
                      isCollapsed ? "" : "rotate-90"
                    } ${t.subTasks.length === 0 ? "invisible" : ""}`}
                  >
                    ›
                  </button>
                  <span className="h-2 w-2 shrink-0 rounded-[2px] border border-accent-blue/60 bg-accent-blue/20" />
                  <span
                    className={`min-w-0 flex-1 truncate text-sm ${
                      t.label.trim() ? "text-ink-900" : "italic text-ink-400"
                    }`}
                  >
                    {t.label.trim() || "Untitled"}
                    {isCollapsed && t.subTasks.length > 0 && (
                      <span className="ml-1.5 text-xs not-italic text-ink-400">
                        · {t.subTasks.length} sub
                      </span>
                    )}
                  </span>
                  {t.qualityFlags.length > 0 && (
                    <span
                      className="flex shrink-0 items-center gap-0.5"
                      title={t.qualityFlags.join(", ")}
                    >
                      {t.qualityFlags.slice(0, 3).map((f) => (
                        <span key={f} className="h-1.5 w-1.5 rounded-full bg-accent-yellow/80" />
                      ))}
                    </span>
                  )}
                  <span className="shrink-0 font-mono text-xs tabular-nums text-ink-500">
                    {t.startFrame}–{t.endFrame}
                    <span
                      className={tHint ? "text-accent-yellow" : "text-ink-400"}
                      title={tHint ? `Duration ${tHint}` : undefined}
                    >
                      {" "}
                      · {dur(t.endFrame - t.startFrame)}s
                    </span>
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectTask(t.id);
                      onOpenEditor();
                    }}
                    title="Open this task's editor (or double-click the row)"
                    className={`shrink-0 text-xs text-ink-400 transition-opacity duration-150 hover:text-ink-900 ${
                      selTask ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                    }`}
                  >
                    Edit ›
                  </button>
                </div>

                {!isCollapsed && t.subTasks.length > 0 && (
                  <ul className="ml-[26px] space-y-0.5 border-l border-ink-900/10 pl-1.5">
                    {t.subTasks.map((s) => {
                      const selSub = selectedSubId === s.id;
                      const idle = s.label.trim() === "idle_wait";
                      const sHint = subTaskDurationHint(s.endFrame - s.startFrame, fps, s.label);
                      return (
                        <li key={s.id}>
                          <div
                            onClick={() => {
                              onSelectSub(t.id, s.id);
                              onSeek(s.startFrame);
                            }}
                            onDoubleClick={() => {
                              onSelectSub(t.id, s.id);
                              onOpenEditor();
                            }}
                            className={`group flex cursor-pointer items-center gap-2 rounded-r-md border-l-2 px-2 py-1.5 transition-colors duration-150 ${
                              selSub
                                ? "border-accent-orange bg-accent-orange/5"
                                : "border-transparent hover:bg-ink-900/[0.03]"
                            }`}
                          >
                            <span
                              className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                                idle ? "bg-accent-yellow/70" : "bg-accent-orange/70"
                              }`}
                            />
                            <span
                              className={`min-w-0 flex-1 truncate text-[13px] ${
                                s.label.trim() ? "text-ink-900" : "italic text-ink-400"
                              }`}
                            >
                              {s.label.trim() || "Untitled"}
                            </span>
                            <span className="shrink-0 font-mono text-xs tabular-nums text-ink-500">
                              {s.startFrame}–{s.endFrame}
                              <span
                                className={sHint ? "text-accent-yellow" : "text-ink-400"}
                                title={sHint ? `Duration ${sHint}` : undefined}
                              >
                                {" "}
                                · {dur(s.endFrame - s.startFrame)}s
                              </span>
                            </span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onSelectSub(t.id, s.id);
                                onOpenEditor();
                              }}
                              title="Open this sub-task's editor (or double-click the row)"
                              className={`shrink-0 text-xs text-ink-400 transition-opacity duration-150 hover:text-ink-900 ${
                                selSub ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                              }`}
                            >
                              Edit ›
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ── editor view ─────────────────────────────────────────────────────────────

function EditorView(props: Props & { task: Task; sub: SubTask | null }) {
  const { task, sub, onBackToList, editable, onCreateSub, onDeleteTask, onDeleteSub } = props;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button
          onClick={onBackToList}
          className="text-sm text-ink-500 transition-colors duration-150 hover:text-ink-900"
        >
          ‹ All tasks
        </button>
        {editable && (
          <div className="flex items-center gap-3">
            {/* Add a sibling without leaving the sub-task view. The parent task
                stays selected while editing one of its sub-tasks, so onCreateSub
                already targets the right task — it tiles on from the last
                sub-task's end and drops straight into the new one's editor. */}
            {sub && (
              <button
                onClick={() => onCreateSub()}
                title="Add another sub-task to this task and edit it (N)"
                className="text-xs text-ink-500 transition-colors duration-150 hover:text-ink-800"
              >
                + New sub-task
              </button>
            )}
            <button
              onClick={() => (sub ? onDeleteSub(sub.id) : onDeleteTask(task.id))}
              className="text-xs text-accent-red transition-colors duration-150 hover:underline"
            >
              Delete {sub ? "sub-task" : "task"}
            </button>
          </div>
        )}
      </div>
      {sub ? <SubTaskEditor {...props} sub={sub} /> : <TaskEditor {...props} />}
    </div>
  );
}

function TaskEditor({
  task,
  editable,
  currentFrame,
  fps,
  taxonomies,
  onUpdateTask,
  onCreateSub,
  onSelectSub,
  onSeek,
}: Props & { task: Task }) {
  const dis = !editable;
  const cov = task.subTasks.length > 0 ? coverage(task) : null;
  const dur = (frames: number) => (fps > 0 ? (frames / fps).toFixed(1) : "–");
  const onUpdate = (patch: Partial<Task>) => onUpdateTask(task.id, patch);

  function toggleFlag(flag: string) {
    const has = task.qualityFlags.includes(flag);
    const next = has
      ? task.qualityFlags.filter((f) => f !== flag)
      : [...task.qualityFlags, flag];
    onUpdate({ qualityFlags: next });
  }

  const isCustom = (val: string, opts: string[]) => !!val && !opts.includes(val);

  // Update a taxonomy field AND recompute the needs_taxonomy_review flag: if any
  // of job/venue L2/venue L3 holds an off-list (custom) value, the flag is on;
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
    <div id="kosha-task-editor" className="space-y-4">
      <div className="text-sm font-medium text-ink-900">
        Task
        <span className="ml-2 font-mono text-xs font-normal tabular-nums text-ink-500">
          {task.startFrame}–{task.endFrame} · {dur(task.endFrame - task.startFrame)}s
        </span>
      </div>

      {/* sub-tasks first — the tiling work happens here */}
      <div className="space-y-1.5 rounded-lg bg-ink-900/[0.02] p-2.5">
        <div className="flex items-center justify-between">
          <div className="label mb-0">
            Sub-tasks{" "}
            <span className="normal-case tracking-normal text-ink-400">
              ({task.subTasks.length})
            </span>
          </div>
          {editable && (
            <div className="flex items-center gap-3">
              <button
                onClick={() => onCreateSub()}
                title="Adds a sub-task at the playhead (continues the tiling)"
                className="text-xs text-ink-500 transition-colors duration-150 hover:text-ink-800"
              >
                + Add sub-task
              </button>
              {(task.subTasks.length === 0 || (cov?.gaps.length ?? 0) > 0) && (
                <button
                  onClick={() => onCreateSub("idle_wait", true)}
                  title="Fill the first uncovered gap with an idle_wait sub-task"
                  className="text-xs text-ink-500 transition-colors duration-150 hover:text-ink-800"
                >
                  + Idle wait
                </button>
              )}
            </div>
          )}
        </div>

        {task.subTasks.length > 0 && (
          <ul className="space-y-0.5">
            {task.subTasks.map((s) => {
              const idle = s.label.trim() === "idle_wait";
              return (
                <li key={s.id}>
                  <button
                    onClick={() => {
                      onSelectSub(task.id, s.id);
                      onSeek(s.startFrame);
                    }}
                    title="Edit this sub-task"
                    className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left transition-colors duration-150 hover:bg-ink-900/5"
                  >
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                        idle ? "bg-accent-yellow/70" : "bg-accent-orange/70"
                      }`}
                    />
                    <span
                      className={`min-w-0 flex-1 truncate text-[13px] ${
                        s.label.trim() ? "text-ink-800" : "italic text-ink-400"
                      }`}
                    >
                      {s.label.trim() || "Untitled"}
                    </span>
                    <span className="shrink-0 font-mono text-[11px] tabular-nums text-ink-400">
                      {s.startFrame}–{s.endFrame}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {cov && (
          <>
            <div className="relative h-1 overflow-hidden rounded-full bg-ink-900/10">
              {task.subTasks.map((s) => {
                const span = Math.max(1, task.endFrame - task.startFrame);
                const left = ((s.startFrame - task.startFrame) / span) * 100;
                const width = ((s.endFrame - s.startFrame) / span) * 100;
                return (
                  <span
                    key={s.id}
                    className="absolute inset-y-0 bg-accent-orange/70"
                    style={{ left: `${left}%`, width: `${Math.max(width, 0.5)}%` }}
                  />
                );
              })}
            </div>
            <div className="flex items-center justify-between text-[10px] tabular-nums">
              <span
                className={
                  cov.pct === 100 && cov.overlaps === 0
                    ? "text-accent-green"
                    : "text-accent-yellow"
                }
              >
                {cov.pct === 100 && cov.overlaps === 0 ? "✓ fully tiled" : `${cov.pct}% tiled`}
              </span>
              <span className="text-ink-400">
                {cov.gaps.length > 0
                  ? `${cov.gaps.length} gap${cov.gaps.length === 1 ? "" : "s"}`
                  : cov.overlaps > 0
                    ? `${cov.overlaps}f overlap`
                    : ""}
              </span>
            </div>
          </>
        )}
      </div>

      <Field label="Label">
        <input
          className="input"
          disabled={dis}
          value={task.label}
          placeholder="verb + noun, e.g. assemble_chair"
          onChange={(e) => onUpdate({ label: e.target.value })}
        />
      </Field>

      <div className="grid grid-cols-2 gap-x-4 gap-y-4">
        <FrameField
          label="Start frame"
          value={task.startFrame}
          disabled={dis}
          onChange={(v) => onUpdate({ startFrame: v })}
          onPlayhead={() => onUpdate({ startFrame: currentFrame })}
        />
        <FrameField
          label="End frame"
          value={task.endFrame}
          disabled={dis}
          onChange={(v) => onUpdate({ endFrame: v })}
          onPlayhead={() => onUpdate({ endFrame: currentFrame })}
        />
        <Field label="Difficulty">
          <select
            className="input"
            disabled={dis}
            value={task.difficulty}
            onChange={(e) => onUpdate({ difficulty: e.target.value })}
          >
            <option value="">—</option>
            {DIFFICULTIES.map((d) => (
              <option key={d} value={d}>
                {d[0].toUpperCase() + d.slice(1)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Job">
          <TaxSelect
            disabled={dis}
            value={task.job}
            options={taxonomies.JOB}
            onChange={(v) => updateTaxonomy({ job: v })}
          />
        </Field>
        <Field label="Venue (L2)">
          <TaxSelect
            disabled={dis}
            value={task.venueL2}
            options={taxonomies.VENUE_L2}
            onChange={(v) => updateTaxonomy({ venueL2: v })}
          />
        </Field>
        <Field label="Venue (L3)">
          <TaxSelect
            disabled={dis}
            value={task.venueL3}
            options={taxonomies.VENUE_L3}
            onChange={(v) => updateTaxonomy({ venueL3: v })}
          />
        </Field>
      </div>

      <Field label="Confidence (0–1)">
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
        <div className="label">Quality flags</div>
        <div className="flex flex-wrap gap-1.5">
          {TASK_QUALITY_FLAGS.map((f) => {
            const on = task.qualityFlags.includes(f);
            return (
              <button
                key={f}
                disabled={dis}
                onClick={() => toggleFlag(f)}
                className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors duration-150 ${
                  on
                    ? "border-accent-yellow/40 bg-accent-yellow/10 text-accent-yellow"
                    : "border-ink-900/15 text-ink-500 hover:border-ink-900/30"
                }`}
              >
                {f}
              </button>
            );
          })}
        </div>
      </div>

      <Field label="Notes">
        <textarea
          className="input resize-y"
          rows={3}
          disabled={dis}
          value={task.notes}
          onChange={(e) => onUpdate({ notes: e.target.value })}
        />
      </Field>
    </div>
  );
}

function SubTaskEditor({
  task,
  sub,
  fps,
  editable,
  currentFrame,
  onUpdateSub,
  onSelectTask,
}: Props & { task: Task; sub: SubTask }) {
  const dis = !editable;
  const dur = (frames: number) => (fps > 0 ? (frames / fps).toFixed(1) : "–");
  const onUpdate = (patch: Partial<SubTask>) => onUpdateSub(sub.id, patch);
  return (
    <div id="kosha-sub-editor" className="space-y-4">
      <div>
        <div className="text-sm font-medium text-ink-900">
          Sub-task
          <span className="ml-2 font-mono text-xs font-normal tabular-nums text-ink-500">
            {sub.startFrame}–{sub.endFrame} · {dur(sub.endFrame - sub.startFrame)}s
          </span>
        </div>
        <button
          onClick={() => onSelectTask(task.id)}
          title="Open the parent task's editor"
          className="mt-0.5 font-mono text-[11px] tabular-nums text-ink-400 transition-colors duration-150 hover:text-ink-800 hover:underline"
        >
          ↑ task {task.startFrame}–{task.endFrame}
          {task.label.trim() ? ` · ${task.label}` : ""}
        </button>
      </div>

      <Field label="Label">
        <input
          className="input"
          disabled={dis}
          value={sub.label}
          placeholder="2–5 snake_case words, e.g. pick_up_screwdriver"
          onChange={(e) => onUpdate({ label: e.target.value })}
        />
      </Field>

      <div className="grid grid-cols-2 gap-x-4 gap-y-4">
        <FrameField
          label="Start frame"
          value={sub.startFrame}
          disabled={dis}
          onChange={(v) => onUpdate({ startFrame: v })}
          onPlayhead={() => onUpdate({ startFrame: currentFrame })}
        />
        <FrameField
          label="End frame"
          value={sub.endFrame}
          disabled={dis}
          onChange={(v) => onUpdate({ endFrame: v })}
          onPlayhead={() => onUpdate({ endFrame: currentFrame })}
        />
      </div>

      <Field label="Description">
        <textarea
          className="input resize-y"
          rows={3}
          disabled={dis}
          value={sub.description}
          placeholder="Overall, then each hand — e.g. operator stands at the cutting board, left hand pins the onion steady, right hand rocks the knife down through it"
          onChange={(e) => onUpdate({ description: e.target.value })}
        />
      </Field>

      <div className="grid grid-cols-2 gap-x-4 gap-y-4">
        <Field label="Object (left hand)">
          <input
            className="input"
            disabled={dis}
            value={sub.objectLeft}
            onChange={(e) => onUpdate({ objectLeft: e.target.value })}
          />
        </Field>
        <Field label="Object (right hand)">
          <input
            className="input"
            disabled={dis}
            value={sub.objectRight}
            onChange={(e) => onUpdate({ objectRight: e.target.value })}
          />
        </Field>
      </div>

      <Field label="Confidence (0–1)">
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
    </div>
  );
}

// ── form primitives ─────────────────────────────────────────────────────────

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
        <option value={CUSTOM_OPTION}>＋ Custom value…</option>
      </select>

      {showCustomInput && (
        <input
          className="input text-accent-yellow"
          disabled={disabled}
          value={value}
          autoFocus
          placeholder="Type a value not on the approved list…"
          onChange={(e) => onChange(e.target.value)}
          title="Custom value — this task will be flagged needs_taxonomy_review"
        />
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="label">{label}</div>
      {children}
    </div>
  );
}

// Frame input with draft state: keystrokes edit a local draft; only valid
// integers commit (on blur or Enter). This prevents transient values like ""
// (which Number() reads as 0) from re-sorting the task list mid-edit — the
// root cause of "tasks jumping around / disappearing" while typing.
function FrameField({
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
  const [draft, setDraft] = useState<string | null>(null); // null = not editing

  function commit() {
    if (draft === null) return;
    const n = Math.round(Number(draft));
    if (draft.trim() !== "" && Number.isFinite(n) && n >= 0 && n !== value) {
      onChange(n);
    }
    setDraft(null);
  }

  return (
    <div>
      <div className="label">{label}</div>
      <div className="relative">
        <input
          className="input pr-8 font-mono tabular-nums"
          type="text"
          inputMode="numeric"
          disabled={disabled}
          value={draft ?? String(value)}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              commit();
              e.currentTarget.blur();
            } else if (e.key === "Escape") {
              setDraft(null);
            }
          }}
        />
        {!disabled && (
          <button
            type="button"
            onClick={() => {
              setDraft(null);
              onPlayhead();
            }}
            title="Set to playhead"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-400 transition-colors duration-150 hover:text-ink-800"
          >
            ⇥
          </button>
        )}
      </div>
    </div>
  );
}
