import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  AppSettings,
  Block,
  BlockKind,
  Category,
  PomodoroPlanMeta,
} from '@shared/types';
import { fromIso, parseTimeInput, toIso } from '../lib/time';
import { CategoryCombobox } from './CategoryCombobox';

interface DraftInput {
  // The draft now carries its lane so a new block created via
  // drag-to-create lands in the same lane the drag started in.
  draft: { startAt: Date; endAt: Date; kind: BlockKind };
}

type Initial = Block | DraftInput;

interface Props {
  day: Date;
  // What's shown in the combobox dropdown — typically active categories.
  categories: Category[];
  // All categories (incl. archived) — used to look up labels/colors so an
  // already-assigned archived category isn't lost when editing.
  allCategories: Category[];
  initial: Initial;
  anchorY: number;
  // For the plan-block "Pomodoro sequence" section: settings provide the
  // long-break/cycle defaults when launching, and a live session blocks
  // the Start button (one session at a time).
  settings: AppSettings;
  sessionActive: boolean;
  onClose: () => void;
  onCommit: () => void;
}

// A plan-meta block's pomodoro field (as opposed to an actual block's
// provenance stamp, which has `source`).
function planMetaOf(b: Block | null): PomodoroPlanMeta | null {
  const p = b?.pomodoro;
  return p && 'reps' in p ? p : null;
}

function isDraft(i: Initial): i is DraftInput {
  return (i as DraftInput).draft != null;
}

export function BlockEditor({
  day,
  categories,
  allCategories,
  initial,
  anchorY,
  settings,
  sessionActive,
  onClose,
  onCommit,
}: Props) {
  const startedAsEditing = !isDraft(initial);

  // The id of the row this editor is bound to. Existing block → its id from
  // the start; new block → null until the first successful create, then the
  // newly-minted id. Backed by a ref so concurrent commits see the latest
  // value even before React re-renders.
  const [currentId, setCurrentId] = useState<number | null>(
    startedAsEditing ? (initial as Block).id : null
  );
  const currentIdRef = useRef<number | null>(currentId);
  useEffect(() => {
    currentIdRef.current = currentId;
  }, [currentId]);

  const initialStart = startedAsEditing
    ? fromIso((initial as Block).start_at)
    : (initial as DraftInput).draft.startAt;
  const initialEnd = startedAsEditing
    ? fromIso((initial as Block).end_at)
    : (initial as DraftInput).draft.endAt;

  // The block's lane. Captured once at open — the editor doesn't expose
  // a control to move a block between lanes (deliberately, to avoid a
  // "secretly converted my plan into a logged actual" misclick). To
  // change lanes the user deletes and recreates.
  const blockKind: BlockKind = startedAsEditing
    ? (initial as Block).kind
    : (initial as DraftInput).draft.kind;

  // If this block was originally synced from a calendar and not yet
  // detached, ANY edit will flip detached=1 so the sync engine stops
  // overwriting / deleting it. Captured at open time so we know the
  // "before" state. We pass detached=true explicitly to the update
  // (rather than relying on merge-preserve semantics) so any future
  // refactor of Blocks.update can't accidentally lose the flag.
  const alreadyDetached =
    startedAsEditing && !!(initial as Block).detached;
  const fromSyncedSource =
    startedAsEditing && (initial as Block).external_source != null;
  // The value we want to persist on every update of this block: true
  // for any block that came from sync, regardless of prior state.
  const shouldBeDetached = fromSyncedSource ? true : alreadyDetached;

  const [startStr, setStartStr] = useState(() => formatHM(initialStart));
  const [endStr, setEndStr] = useState(() => formatHM(initialEnd));
  const [categoryId, setCategoryId] = useState<number | null>(
    startedAsEditing
      ? (initial as Block).category_id
      : categories.find((c) => !c.archived)?.id ?? null
  );
  const [note, setNote] = useState(
    startedAsEditing ? (initial as Block).note ?? '' : ''
  );
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleted, setDeleted] = useState(false);

  // Pomodoro sequence (plan blocks only). Seeded from the block's stored
  // plan meta when present.
  const initialPlanMeta = startedAsEditing
    ? planMetaOf(initial as Block)
    : null;
  const [pomoEnabled, setPomoEnabled] = useState(initialPlanMeta != null);
  const [pomoWork, setPomoWork] = useState(
    initialPlanMeta?.workMinutes ?? settings.pomodoroWorkMinutes
  );
  const [pomoBreak, setPomoBreak] = useState(
    initialPlanMeta?.breakMinutes ?? settings.pomodoroBreakMinutes
  );
  const [pomoReps, setPomoReps] = useState(initialPlanMeta?.reps ?? 3);

  // Keep the live state in a ref so commit() — which may be called from
  // outside-this-render contexts (document mousedown, setTimeout, etc.) —
  // always sees the latest values.
  const stateRef = useRef({
    startStr,
    endStr,
    categoryId,
    note,
    pomoEnabled,
    pomoWork,
    pomoBreak,
    pomoReps,
  });
  useEffect(() => {
    stateRef.current = {
      startStr,
      endStr,
      categoryId,
      note,
      pomoEnabled,
      pomoWork,
      pomoBreak,
      pomoReps,
    };
  });

  // Locally computed previews shown beneath the inputs.
  const startDate = useMemo(() => parseTimeInput(startStr, day), [startStr, day]);
  const endDate = useMemo(() => parseTimeInput(endStr, day), [endStr, day]);

  const rootRef = useRef<HTMLDivElement>(null);
  const startRef = useRef<HTMLInputElement>(null);

  // A chain of pending commits. Each new commit waits for the previous one
  // to finish, then runs its own write with the latest state from stateRef.
  // This is "queue" semantics, not "dedup" — it prevents lost updates.
  const chainRef = useRef<Promise<boolean>>(Promise.resolve(true));

  useEffect(() => {
    startRef.current?.focus();
    startRef.current?.select();
  }, []);

  async function commit(): Promise<boolean> {
    if (deleted) return true;
    const previous = chainRef.current;
    const mine = (async () => {
      try {
        await previous;
      } catch {
        // a prior failure shouldn't stop this commit from being attempted
      }
      const {
        startStr,
        endStr,
        categoryId,
        note,
        pomoEnabled,
        pomoWork,
        pomoBreak,
        pomoReps,
      } = stateRef.current;
      const startDate = parseTimeInput(startStr, day);
      const endDate = parseTimeInput(endStr, day);
      if (!startDate || !endDate) {
        setError('Could not parse time');
        return false;
      }
      if (endDate <= startDate) {
        setError('End must be after start');
        return false;
      }
      if (!categoryId) {
        setError('Pick a category');
        return false;
      }
      // Plan blocks carry their sequence meta (or explicit null when the
      // toggle is off, so turning it off persists). Actual blocks pass
      // undefined — never touch a pomodoro provenance stamp from here.
      const pomodoro =
        blockKind === 'plan'
          ? pomoEnabled
            ? {
                workMinutes: clampInt(pomoWork, 1, 180),
                breakMinutes: clampInt(pomoBreak, 1, 60),
                reps: clampInt(pomoReps, 1, 20),
              }
            : null
          : undefined;
      try {
        const id = currentIdRef.current;
        if (id != null) {
          await window.api.blocks.update({
            id,
            categoryId,
            startAt: toIso(startDate),
            endAt: toIso(endDate),
            note: note.trim() ? note.trim() : null,
            // Lane is captured at editor open and never changes here —
            // pass it explicitly so a downstream merge mistake can't
            // silently flip a Plan into an Actual or vice versa.
            kind: blockKind,
            // Sync provenance: any block that came from sync stays
            // detached after a user edit (sticky). Passed on every
            // save so the column value is always explicit, not
            // relying on the DB merge to preserve it.
            detached: shouldBeDetached,
            pomodoro,
          });
        } else {
          const created = await window.api.blocks.create({
            categoryId,
            startAt: toIso(startDate),
            endAt: toIso(endDate),
            note: note.trim() ? note.trim() : null,
            kind: blockKind,
            pomodoro,
          });
          currentIdRef.current = created.id;
          setCurrentId(created.id);
        }
        setError(null);
        onCommit();
        return true;
      } catch (e: any) {
        setError(e?.message ?? 'Failed to save');
        return false;
      }
    })();
    chainRef.current = mine;
    return mine;
  }

  // Keep a ref to the latest commit so the document mousedown handler
  // (registered once) doesn't run a stale closure.
  const commitRef = useRef<() => Promise<boolean>>(commit);
  commitRef.current = commit;

  // Resize the block to fit the sequence: reps × focus, with breaks
  // BETWEEN reps (no trailing break — the plan represents work intent).
  // The end stays hand-editable afterwards; the meta is what launches.
  function applySequenceSize(work: number, brk: number, reps: number) {
    const start = parseTimeInput(stateRef.current.startStr, day);
    if (!start) return;
    const r = clampInt(reps, 1, 20);
    const minutes =
      r * clampInt(work, 1, 180) + Math.max(0, r - 1) * clampInt(brk, 1, 60);
    const end = new Date(start.getTime() + minutes * 60000);
    const next = formatHM(end);
    setEndStr(next);
    stateRef.current = { ...stateRef.current, endStr: next };
    commit();
  }

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        commitRef.current().then(() => onClose());
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  // Build the combobox list. Always include the currently-selected category
  // (even if archived) so the user sees what's bound and can keep it or
  // change it.
  const comboboxCategories = useMemo(() => {
    if (categoryId == null) return categories;
    const inList = categories.some((c) => c.id === categoryId);
    if (inList) return categories;
    const extra = allCategories.find((c) => c.id === categoryId);
    return extra ? [extra, ...categories] : categories;
  }, [categories, allCategories, categoryId]);

  return (
    <div
      ref={rootRef}
      className="popover absolute z-30 p-3 w-[320px]"
      style={{
        top: Math.max(0, anchorY),
        right: 24,
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          e.stopPropagation();
          commit().then((ok) => ok && onClose());
        }
      }}
    >
      {blockKind === 'plan' && (
        <div className="mb-2 flex items-center justify-between">
          <span
            className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider px-1.5 py-[2px] rounded-[3px]"
            style={{
              background: 'var(--hover)',
              color: 'var(--muted)',
            }}
            title="Plan blocks don't count toward weekly stats"
          >
            <span
              className="w-1 h-1 rounded-full"
              style={{ background: 'var(--muted)' }}
              aria-hidden
            />
            Plan
          </span>
        </div>
      )}
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <label className="block text-[11px] uppercase tracking-wider text-faint mb-1">
            Start
          </label>
          <input
            ref={startRef}
            className="input-bare w-full tabular-nums"
            value={startStr}
            onChange={(e) => {
              setStartStr(e.target.value);
              setError(null);
            }}
            onBlur={() => commit()}
          />
          <div className="mt-1 text-[10.5px] tabular-nums text-faint">
            {startDate ? formatHM(startDate) : '—'}
          </div>
        </div>
        <div className="flex-1">
          <label className="block text-[11px] uppercase tracking-wider text-faint mb-1">
            End
          </label>
          <input
            className="input-bare w-full tabular-nums"
            value={endStr}
            onChange={(e) => {
              setEndStr(e.target.value);
              setError(null);
            }}
            onBlur={() => commit()}
          />
          <div className="mt-1 text-[10.5px] tabular-nums text-faint">
            {endDate ? formatHM(endDate) : '—'}
          </div>
        </div>
      </div>

      <div className="mt-3">
        <label className="block text-[11px] uppercase tracking-wider text-faint mb-1">
          Category
        </label>
        <CategoryCombobox
          categories={comboboxCategories}
          value={categoryId}
          onChange={(id) => {
            setCategoryId(id);
            // Commit right away — the combobox doesn't have a natural blur.
            // The chain serializes this with any pending input-blur commit.
            // stateRef is updated by the effect on the next render, but we
            // need this commit to see the new categoryId now, so write it.
            stateRef.current = {
              ...stateRef.current,
              categoryId: id,
            };
            commit();
          }}
        />
      </div>

      <div className="mt-3">
        <label className="block text-[11px] uppercase tracking-wider text-faint mb-1">
          Description{' '}
          <span className="normal-case text-faint">(shown on the block)</span>
        </label>
        <textarea
          rows={2}
          className="input-bare w-full resize-none"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => commit()}
          placeholder="A few words about what this block is."
        />
      </div>

      {blockKind === 'plan' && (
        <div className="mt-3 pt-3 border-t border-line">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={pomoEnabled}
              onChange={(e) => {
                setPomoEnabled(e.target.checked);
                stateRef.current = {
                  ...stateRef.current,
                  pomoEnabled: e.target.checked,
                };
                if (e.target.checked) {
                  applySequenceSize(pomoWork, pomoBreak, pomoReps);
                } else {
                  commit();
                }
              }}
            />
            <span className="text-xs">Pomodoro sequence</span>
          </label>

          {pomoEnabled && (
            <>
              <div className="mt-2 grid grid-cols-3 gap-2">
                <SequenceField
                  label="Focus"
                  value={pomoWork}
                  max={180}
                  onChange={(n) => {
                    setPomoWork(n);
                    stateRef.current = { ...stateRef.current, pomoWork: n };
                    applySequenceSize(n, pomoBreak, pomoReps);
                  }}
                />
                <SequenceField
                  label="Break"
                  value={pomoBreak}
                  max={60}
                  onChange={(n) => {
                    setPomoBreak(n);
                    stateRef.current = { ...stateRef.current, pomoBreak: n };
                    applySequenceSize(pomoWork, n, pomoReps);
                  }}
                />
                <SequenceField
                  label="Reps"
                  value={pomoReps}
                  max={20}
                  onChange={(n) => {
                    setPomoReps(n);
                    stateRef.current = { ...stateRef.current, pomoReps: n };
                    applySequenceSize(pomoWork, pomoBreak, n);
                  }}
                />
              </div>
              <div className="mt-1.5 text-[10.5px] text-faint">
                {pomoReps} × {pomoWork}m focus, {pomoBreak}m breaks between —
                End follows automatically; edit it freely after.
              </div>
              {currentId != null && (
                <button
                  className="btn btn-primary text-xs w-full mt-2"
                  disabled={sessionActive}
                  style={sessionActive ? { opacity: 0.5, cursor: 'default' } : undefined}
                  title={
                    sessionActive
                      ? 'A session is already running — finish it first'
                      : 'Launch this sequence as a live pomodoro session now'
                  }
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={async () => {
                    if (sessionActive) return;
                    const ok = await commit();
                    if (!ok) return;
                    const s = stateRef.current;
                    try {
                      await window.api.pomodoro.start({
                        categoryId: s.categoryId!,
                        note: s.note.trim() ? s.note.trim() : null,
                        workMinutes: clampInt(s.pomoWork, 1, 180),
                        breakMinutes: clampInt(s.pomoBreak, 1, 60),
                        longBreakMinutes: settings.pomodoroLongBreakMinutes,
                        pomodorosPerCycle: settings.pomodorosPerCycle,
                        planBlockId: currentIdRef.current,
                      });
                      onClose();
                    } catch (e: any) {
                      setError(e?.message ?? 'Could not start the sequence');
                    }
                  }}
                >
                  Start this sequence
                </button>
              )}
            </>
          )}
        </div>
      )}

      {error && <div className="mt-2 text-xs text-[#A66E5C]">{error}</div>}

      <div className="mt-3 flex items-center justify-between gap-2">
        {currentId != null ? (
          confirmDelete ? (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted">Delete this block?</span>
              <button
                className="text-xs underline text-[#A66E5C]"
                onMouseDown={(e) => e.preventDefault()}
                onClick={async () => {
                  setDeleted(true);
                  try {
                    await window.api.blocks.delete(currentId);
                  } catch (e: any) {
                    setError(e?.message ?? 'Failed to delete');
                    setDeleted(false);
                    return;
                  }
                  onCommit();
                  onClose();
                }}
              >
                Yes
              </button>
              <button
                className="text-xs underline text-muted"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setConfirmDelete(false)}
              >
                No
              </button>
            </div>
          ) : (
            <button
              className="text-xs text-muted hover:text-[#A66E5C]"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setConfirmDelete(true)}
            >
              Delete
            </button>
          )
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2">
          <button
            className="btn btn-ghost text-xs"
            onMouseDown={(e) => e.preventDefault()}
            onClick={onClose}
          >
            Close
          </button>
          <button
            className="btn btn-primary text-xs"
            onMouseDown={(e) => e.preventDefault()}
            onClick={async () => {
              const ok = await commit();
              if (ok) onClose();
            }}
          >
            {currentId != null ? 'Done' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

function formatHM(d: Date): string {
  const h = d.getHours();
  const m = d.getMinutes();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}`;
}

function clampInt(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(n)));
}

function SequenceField({
  label,
  value,
  max,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  onChange: (n: number) => void;
}) {
  // Local string draft so the field can be emptied while retyping —
  // binding the input straight to the number would snap "" back to the
  // old value and make small numbers impossible to type. The parent
  // keeps the last valid number; blur re-syncs the display to it.
  const [draft, setDraft] = useState(String(value));
  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  return (
    <div>
      <label className="block text-[11px] uppercase tracking-wider text-faint mb-1">
        {label}
      </label>
      <input
        type="number"
        min={1}
        max={max}
        className="input-bare w-full tabular-nums"
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          const n = parseInt(e.target.value, 10);
          if (Number.isFinite(n)) onChange(n);
        }}
        onBlur={() => setDraft(String(value))}
      />
    </div>
  );
}
