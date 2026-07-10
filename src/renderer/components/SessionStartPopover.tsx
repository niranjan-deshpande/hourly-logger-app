import { useEffect, useRef, useState } from 'react';
import type { Category } from '@shared/types';
import { CategoryCombobox } from './CategoryCombobox';

interface Props {
  // Active categories shown in the combobox.
  categories: Category[];
  // Anchored relative to the QuickAdd bar: we render below the bar's
  // right edge. Parent passes the right/top offsets.
  anchorRight: number;
  anchorTop: number;
  // Seed values for the pomodoro controls (from settings).
  pomodoroDefaults: {
    workMinutes: number;
    breakMinutes: number;
    pomodorosPerCycle: number;
  };
  onCancel: () => void;
  onStart: (input: {
    categoryId: number;
    note: string | null;
    // Present iff "Pomodoro mode" was toggled on.
    pomodoro?: {
      workMinutes: number;
      breakMinutes: number;
      pomodorosPerCycle: number;
    };
  }) => void;
}

const WORK_PRESETS = [25, 45, 50];
const BREAK_PRESETS = [5, 10, 15];
const CYCLE_PRESETS = [2, 3, 4];

// The pre-session popover. Pick a category and (optionally) describe what
// you're about to do, then click Start recording. The timer starts the
// instant the parent invokes onStart — the popover doesn't track time
// itself.
export function SessionStartPopover({
  categories,
  anchorRight,
  anchorTop,
  pomodoroDefaults,
  onCancel,
  onStart,
}: Props) {
  const [categoryId, setCategoryId] = useState<number | null>(
    categories[0]?.id ?? null
  );
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Pomodoro mode: off by default — a plain stopwatch recording stays
  // the unchanged default flow.
  const [pomodoroOn, setPomodoroOn] = useState(false);
  const [workMinutes, setWorkMinutes] = useState(pomodoroDefaults.workMinutes);
  const [breakMinutes, setBreakMinutes] = useState(
    pomodoroDefaults.breakMinutes
  );
  const [perCycle, setPerCycle] = useState(pomodoroDefaults.pomodorosPerCycle);

  const rootRef = useRef<HTMLDivElement>(null);

  // Clicking outside dismisses without starting. (We can't accidentally
  // start a recording — that needs an explicit Start press.)
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        onCancel();
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel();
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onCancel]);

  function start() {
    if (!categoryId) {
      setError('Pick a category');
      return;
    }
    onStart({
      categoryId,
      note: note.trim() ? note.trim() : null,
      pomodoro: pomodoroOn
        ? {
            workMinutes: clamp(workMinutes, 1, 180),
            breakMinutes: clamp(breakMinutes, 1, 60),
            pomodorosPerCycle: clamp(perCycle, 1, 12),
          }
        : undefined,
    });
  }

  return (
    <div
      ref={rootRef}
      className="popover absolute z-30 p-3 w-[320px]"
      style={{ top: anchorTop, right: anchorRight }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          e.stopPropagation();
          start();
        }
      }}
    >
      <div className="text-[11px] uppercase tracking-wider text-faint mb-2">
        Start a session
      </div>

      <div>
        <label className="block text-[11px] uppercase tracking-wider text-faint mb-1">
          Category
        </label>
        <CategoryCombobox
          categories={categories}
          value={categoryId}
          onChange={setCategoryId}
          autoFocus
        />
      </div>

      <div className="mt-3">
        <label className="block text-[11px] uppercase tracking-wider text-faint mb-1">
          Description{' '}
          <span className="normal-case text-faint">(optional)</span>
        </label>
        <textarea
          rows={2}
          className="input-bare w-full resize-none"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What are you about to do?"
        />
      </div>

      {/* Pomodoro mode. A plain recording is the default; toggling this
          on hands the session to the work/break cycle engine. */}
      <div className="mt-3 pt-3 border-t border-line">
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={pomodoroOn}
            onChange={(e) => setPomodoroOn(e.target.checked)}
          />
          <span className="text-xs">Pomodoro mode</span>
          <span className="text-[11px] text-faint">
            focus / break cycles
          </span>
        </label>

        {pomodoroOn && (
          <>
            <div className="mt-2 grid grid-cols-2 gap-3">
              <DurationField
                label="Focus (min)"
                value={workMinutes}
                presets={WORK_PRESETS}
                max={180}
                onChange={setWorkMinutes}
              />
              <DurationField
                label="Break (min)"
                value={breakMinutes}
                presets={BREAK_PRESETS}
                max={60}
                onChange={setBreakMinutes}
              />
            </div>
            <div className="mt-2">
              <DurationField
                label="Long break every (focuses)"
                value={perCycle}
                presets={CYCLE_PRESETS}
                max={12}
                onChange={setPerCycle}
              />
            </div>
          </>
        )}
      </div>

      {error && <div className="mt-2 text-xs text-[#A66E5C]">{error}</div>}

      <div className="mt-3 flex items-center justify-end gap-2">
        <button
          className="btn btn-ghost text-xs"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          className="btn btn-primary text-xs"
          onMouseDown={(e) => e.preventDefault()}
          onClick={start}
        >
          {pomodoroOn ? 'Start pomodoro' : 'Start recording'}
        </button>
      </div>
    </div>
  );
}

function DurationField({
  label,
  value,
  presets,
  max,
  onChange,
}: {
  label: string;
  value: number;
  presets: number[];
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
      <div className="mt-1 flex items-center gap-1">
        {presets.map((p) => (
          <button
            key={p}
            type="button"
            className={`tag-pill text-[11px] ${value === p ? 'active' : ''}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onChange(p)}
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(n)));
}
