import { useEffect, useRef, useState } from 'react';
import type { ActiveSession, Category, PomodoroSnapshot } from '@shared/types';
import { formatDuration, formatTime, fromIso } from '../lib/time';
import { CategoryCombobox } from './CategoryCombobox';
import { PomodoroCycleDots, pomodoroPhaseLabel } from './pomodoroUi';

interface Props {
  session: ActiveSession;
  // Live pomodoro snapshot; only meaningful when session.pomodoro is set.
  pomodoro: PomodoroSnapshot | null;
  // Active categories shown in the combobox. We also fold in the session's
  // current category (even if archived) so the user always sees what's
  // bound and can keep or change it.
  categories: Category[];
  allCategories: Category[];
  anchorY: number;
  // Persisted edits to category/note flow through the parent (which calls
  // the IPC and updates app state).
  onUpdate: (input: { categoryId?: number; note?: string | null }) => void;
  onFinish: () => void;
  onDiscard: () => void;
  onClose: () => void;
}

// One-shot next-phase override input. Empty = follow the session
// default (shown as the placeholder); a number = override the next
// focus/break only. Commits on blur/Enter; clearing the field clears
// the override.
function NextOverrideField({
  label,
  override,
  sessionDefault,
  max,
  onCommit,
}: {
  label: string;
  override: number | null;
  sessionDefault: number;
  max: number;
  onCommit: (n: number | null) => void;
}) {
  const [draft, setDraft] = useState(override == null ? '' : String(override));
  useEffect(() => {
    setDraft(override == null ? '' : String(override));
  }, [override]);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed === '') {
      if (override != null) onCommit(null);
      return;
    }
    const n = parseInt(trimmed, 10);
    if (!Number.isFinite(n)) {
      setDraft(override == null ? '' : String(override));
      return;
    }
    const clamped = Math.max(1, Math.min(max, n));
    setDraft(String(clamped));
    if (clamped !== override) onCommit(clamped);
  };

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
        placeholder={String(sessionDefault)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            commit();
          }
        }}
      />
    </div>
  );
}

// Popover for editing the in-progress session. Times are locked to the
// timer — only category and description can change. Finish and Discard
// commit/abort the session respectively.
export function RecordingEditor({
  session,
  pomodoro,
  categories,
  allCategories,
  anchorY,
  onUpdate,
  onFinish,
  onDiscard,
  onClose,
}: Props) {
  const startDate = fromIso(session.startAt);
  const [categoryId, setCategoryId] = useState<number>(session.categoryId);
  const [note, setNote] = useState(session.note ?? '');
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  // Track elapsed time so the popover header shows live duration. One
  // tick per second is plenty for a duration readout that's displayed in
  // minutes/hours.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const rootRef = useRef<HTMLDivElement>(null);

  // Outside click closes (but does NOT finish — finishing is explicit).
  // Any pending category/note changes have already been pushed to the
  // active-session file via onUpdate at the moment of change.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        onClose();
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

  // Include the bound category in the combobox list even if it's archived,
  // matching BlockEditor's logic.
  const comboboxCategories = (() => {
    const inList = categories.some((c) => c.id === categoryId);
    if (inList) return categories;
    const extra = allCategories.find((c) => c.id === categoryId);
    return extra ? [extra, ...categories] : categories;
  })();

  const pomo = session.pomodoro ?? null;
  // For pomodoro sessions in 'awaiting', the elapsed readout freezes at
  // the last break's end — the same end the block would get on Finish.
  const liveEnd =
    pomo && pomo.phase === 'awaiting' && pomo.lastPhaseEndAt
      ? fromIso(pomo.lastPhaseEndAt)
      : new Date();
  const elapsedMs = liveEnd.getTime() - startDate.getTime();

  return (
    <div
      ref={rootRef}
      className="popover absolute z-30 p-3 w-[320px]"
      style={{ top: Math.max(0, anchorY), right: 24 }}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-faint">
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ background: '#A66E5C' }}
            aria-hidden
          />
          {pomo ? 'Pomodoro' : 'Recording'}
        </div>
        <div className="text-[11px] text-muted tabular-nums">
          {formatDuration(elapsedMs)} · started {formatTime(startDate)}
        </div>
      </div>

      {pomo && pomodoro && (
        <div className="mb-3 flex items-center justify-between gap-2 rounded-md border border-line px-2 py-1.5">
          <div className="flex items-center gap-2">
            <PomodoroCycleDots
              repsCompleted={pomo.repsCompleted}
              pomodorosPerCycle={pomo.pomodorosPerCycle}
            />
            <span className="text-xs tabular-nums text-muted" role="status">
              {pomodoroPhaseLabel(pomo, pomodoro.timer)}
            </span>
          </div>
          {pomo.phase === 'work' &&
            (pomo.isPaused ? (
              <button
                className="btn btn-ghost text-xs"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => window.api.pomodoro.resume()}
              >
                Resume
              </button>
            ) : (
              <button
                className="btn btn-ghost text-xs"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => window.api.pomodoro.pause()}
              >
                Pause
              </button>
            ))}
          {pomo.phase === 'awaiting' && (
            <button
              className="btn btn-ghost text-xs"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => window.api.pomodoro.startNextRep()}
            >
              Start next focus
            </button>
          )}
        </div>
      )}

      {/* One-shot adjustments for the NEXT phase. The session defaults
          (chosen at start) stay in charge — leave a field empty and the
          default applies; type a number to override just the next
          focus/break. */}
      {pomo && (
        <div className="mb-3 grid grid-cols-2 gap-3">
          <NextOverrideField
            label="Next focus (min)"
            override={pomo.nextWorkMinutes}
            sessionDefault={pomo.workMinutes}
            max={180}
            onCommit={(n) =>
              window.api.pomodoro.setNextOverrides({ workMinutes: n })
            }
          />
          <NextOverrideField
            label="Next break (min)"
            override={pomo.nextBreakMinutes}
            sessionDefault={pomo.breakMinutes}
            max={60}
            onCommit={(n) =>
              window.api.pomodoro.setNextOverrides({ breakMinutes: n })
            }
          />
        </div>
      )}

      <div>
        <label className="block text-[11px] uppercase tracking-wider text-faint mb-1">
          Category
        </label>
        <CategoryCombobox
          categories={comboboxCategories}
          value={categoryId}
          onChange={(id) => {
            setCategoryId(id);
            onUpdate({ categoryId: id });
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
          onBlur={() => onUpdate({ note: note.trim() ? note.trim() : null })}
          placeholder="What are you working on?"
        />
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        {confirmDiscard ? (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted">Discard this session?</span>
            <button
              className="text-xs underline text-[#A66E5C]"
              onMouseDown={(e) => e.preventDefault()}
              onClick={onDiscard}
            >
              Yes
            </button>
            <button
              className="text-xs underline text-muted"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setConfirmDiscard(false)}
            >
              No
            </button>
          </div>
        ) : (
          <button
            className="text-xs text-muted hover:text-[#A66E5C]"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setConfirmDiscard(true)}
          >
            Discard
          </button>
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
            onClick={onFinish}
          >
            {pomo ? 'Finish session' : 'Finish recording'}
          </button>
        </div>
      </div>
    </div>
  );
}
