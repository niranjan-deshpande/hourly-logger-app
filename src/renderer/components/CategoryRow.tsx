import { useEffect, useRef, useState } from 'react';
import { Archive, ArchiveRestore, Edit3, Palette, Target } from 'lucide-react';
import type { Category, Goal } from '@shared/types';
import { formatHours } from '../lib/time';
import { ColorPicker } from './ColorPicker';

interface Props {
  category: Category;
  // Active goal revisions for this category (weekly and/or habit).
  goals: Goal[];
  hours: number;
  active: boolean;
  onClick: () => void;
  onUpdated: () => Promise<void> | void;
}

export function CategoryRow({
  category,
  goals,
  hours,
  active,
  onClick,
  onUpdated,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [coloring, setColoring] = useState(false);
  const [goalsOpen, setGoalsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rowRef = useRef<HTMLLIElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renaming) {
      setError(null);
      inputRef.current?.select();
    }
  }, [renaming]);

  async function applyRename(v: string) {
    if (!v || v === category.name) {
      setRenaming(false);
      return;
    }
    try {
      await window.api.categories.update({ id: category.id, name: v });
      await onUpdated();
      setRenaming(false);
    } catch (e: any) {
      setError(e?.message ?? 'Could not rename');
      // keep the input open so the user can correct
    }
  }

  return (
    <li
      ref={rowRef}
      className={`group relative flex items-center gap-2 px-3 h-8 rounded ${
        active ? 'bg-[var(--select)]' : 'hover:bg-[var(--hover)]'
      } ${category.archived ? 'opacity-50' : ''}`}
    >
      <button
        className="flex items-center gap-2 flex-1 min-w-0 text-left"
        onClick={onClick}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenuOpen(true);
        }}
        title={category.name}
      >
        <span
          className="inline-block w-2 h-2 rounded-full shrink-0"
          style={{ backgroundColor: category.color }}
        />
        {renaming ? (
          <input
            ref={inputRef}
            defaultValue={category.name}
            className="input-bare h-6 py-0 flex-1 min-w-0"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') {
                applyRename((e.target as HTMLInputElement).value.trim());
              } else if (e.key === 'Escape') {
                setRenaming(false);
                setError(null);
              }
            }}
            onBlur={(e) => applyRename(e.target.value.trim())}
          />
        ) : (
          <span className="text-sm truncate flex-1">{category.name}</span>
        )}
      </button>
      {!renaming && (
        <span className="text-[11px] tabular-nums text-faint shrink-0">
          {hours > 0 ? formatHours(hours) : ''}
        </span>
      )}
      {menuOpen && (
        <div
          className="popover absolute right-2 top-8 z-30 py-1 min-w-[140px]"
          onMouseLeave={() => setMenuOpen(false)}
        >
          <MenuItem
            icon={<Edit3 size={13} strokeWidth={1.5} />}
            label="Rename"
            onClick={() => {
              setMenuOpen(false);
              setRenaming(true);
            }}
          />
          <MenuItem
            icon={<Palette size={13} strokeWidth={1.5} />}
            label="Change color"
            onClick={() => {
              setMenuOpen(false);
              setColoring(true);
            }}
          />
          <MenuItem
            icon={<Target size={13} strokeWidth={1.5} />}
            label="Goals…"
            onClick={() => {
              setMenuOpen(false);
              setGoalsOpen(true);
            }}
          />
          <MenuItem
            icon={
              category.archived ? (
                <ArchiveRestore size={13} strokeWidth={1.5} />
              ) : (
                <Archive size={13} strokeWidth={1.5} />
              )
            }
            label={category.archived ? 'Unarchive' : 'Archive'}
            onClick={async () => {
              setMenuOpen(false);
              await window.api.categories.update({
                id: category.id,
                archived: !category.archived,
              });
              await onUpdated();
            }}
          />
        </div>
      )}
      {goalsOpen && (
        <GoalsEditor
          category={category}
          goals={goals}
          onClose={() => setGoalsOpen(false)}
          onUpdated={onUpdated}
        />
      )}
      {coloring && (
        <ColorPicker
          value={category.color}
          onClose={() => setColoring(false)}
          onPick={async (hex) => {
            setColoring(false);
            try {
              await window.api.categories.update({ id: category.id, color: hex });
              await onUpdated();
            } catch (e: any) {
              setError(e?.message ?? 'Could not update color');
            }
          }}
        />
      )}
      {error && (
        <div
          className="absolute left-3 top-8 z-30 text-[11px] text-[#A66E5C] popover px-2 py-1"
          onClick={(e) => e.stopPropagation()}
        >
          {error}
        </div>
      )}
    </li>
  );
}

// Per-category goal editor: a weekly hour target (empty = none, decimals
// fine — stored as minutes) and a habit goal (off, every day, or N days per
// week). Both commit immediately through the goals API; progress/streaks
// are computed elsewhere from blocks + exemptions.
type HabitMode = 'off' | 'daily_habit' | 'weekly_frequency';

function GoalsEditor({
  category,
  goals,
  onClose,
  onUpdated,
}: {
  category: Category;
  goals: Goal[];
  onClose: () => void;
  onUpdated: () => Promise<void> | void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const weeklyGoal = goals.find((g) => g.kind === 'weekly_minutes');
  const habitGoal = goals.find(
    (g) => g.kind === 'daily_habit' || g.kind === 'weekly_frequency'
  );
  const [hoursDraft, setHoursDraft] = useState(
    weeklyGoal == null
      ? ''
      : String(Math.round((weeklyGoal.target / 60) * 10) / 10)
  );
  const [habitMode, setHabitMode] = useState<HabitMode>(
    habitGoal ? (habitGoal.kind as HabitMode) : 'off'
  );
  const [freqTarget, setFreqTarget] = useState<number>(
    habitGoal?.kind === 'weekly_frequency' ? habitGoal.target : 3
  );
  const [err, setErr] = useState<string | null>(null);

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

  async function commitHours() {
    const trimmed = hoursDraft.trim();
    let minutes: number | null;
    if (trimmed === '') {
      minutes = null;
    } else {
      const h = parseFloat(trimmed);
      if (!Number.isFinite(h) || h <= 0) {
        setErr('Enter hours, e.g. 30 or 7.5 — empty for no goal');
        return;
      }
      minutes = Math.max(1, Math.min(10080, Math.round(h * 60)));
    }
    if (minutes === (weeklyGoal?.target ?? null)) return;
    try {
      await window.api.goals.setWeekly({ categoryId: category.id, minutes });
      setErr(null);
      await onUpdated();
    } catch (e: any) {
      setErr(e?.message ?? 'Could not save goal');
    }
  }

  // Optimistic-update-and-rollback, matching the old checkbox: set local
  // state, call the API, revert on failure.
  async function saveHabit(mode: HabitMode, target: number) {
    const prevMode = habitMode;
    const prevTarget = freqTarget;
    setHabitMode(mode);
    setFreqTarget(target);
    const habit =
      mode === 'off'
        ? null
        : mode === 'daily_habit'
          ? ({ kind: 'daily_habit' } as const)
          : ({ kind: 'weekly_frequency', target } as const);
    try {
      await window.api.goals.setHabit({ categoryId: category.id, habit });
      setErr(null);
      await onUpdated();
    } catch (e: any) {
      setErr(e?.message ?? 'Could not save goal');
      setHabitMode(prevMode);
      setFreqTarget(prevTarget);
    }
  }

  return (
    <div
      ref={rootRef}
      className="popover absolute right-2 top-8 z-30 p-3 w-[240px]"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="text-[11px] uppercase tracking-wider text-faint mb-2">
        Goals · {category.name}
      </div>
      <label className="block text-[11px] uppercase tracking-wider text-faint mb-1">
        Weekly target (hours)
      </label>
      <input
        type="number"
        min={0}
        step={0.5}
        className="input-bare w-full tabular-nums"
        placeholder="none"
        value={hoursDraft}
        onChange={(e) => {
          setHoursDraft(e.target.value);
          setErr(null);
        }}
        onBlur={commitHours}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') commitHours();
        }}
      />
      <label className="mt-3 block text-[11px] uppercase tracking-wider text-faint mb-1">
        Habit
      </label>
      <div className="flex items-center gap-2">
        <select
          className="input-bare flex-1"
          value={habitMode}
          onChange={(e) => saveHabit(e.target.value as HabitMode, freqTarget)}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <option value="off">Off</option>
          <option value="daily_habit">Every day</option>
          <option value="weekly_frequency">Days per week</option>
        </select>
        {habitMode === 'weekly_frequency' && (
          <input
            type="number"
            min={1}
            max={6}
            className="input-bare w-14 tabular-nums"
            value={freqTarget}
            onChange={(e) => {
              const n = Math.max(1, Math.min(6, Math.round(Number(e.target.value) || 1)));
              saveHabit('weekly_frequency', n);
            }}
            onKeyDown={(e) => e.stopPropagation()}
          />
        )}
      </div>
      <div className="mt-1 text-[10.5px] text-faint">
        {habitMode === 'weekly_frequency'
          ? 'streaks count whole weeks'
          : habitMode === 'daily_habit'
            ? 'once a day, streaks'
            : 'no habit'}
      </div>
      {err && <div className="mt-2 text-xs text-[#A66E5C]">{err}</div>}
      <div className="mt-3 flex justify-end">
        <button
          className="btn btn-ghost text-xs"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onClose}
        >
          Close
        </button>
      </div>
    </div>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-[var(--hover)]"
    >
      <span className="text-muted">{icon}</span>
      {label}
    </button>
  );
}
