import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Plus,
  Settings as SettingsIcon,
} from 'lucide-react';
import type { Block, Category, Goal } from '@shared/types';
import {
  addDays,
  endOfLocalDay,
  fromIso,
  fromIsoYmd,
  isoYmd,
  readableDate,
  shortDate,
  startOfLocalDay,
  startOfWeek,
  toIso,
} from '../lib/time';
import { CategoryRow } from './CategoryRow';
import { NewCategoryDialog } from './NewCategoryDialog';
import { GoalsPanel } from './GoalsPanel';
import type { DateRange, ViewMode } from '../App';

interface Props {
  view: ViewMode;
  day: Date;
  onDayChange: (d: Date) => void;
  range: DateRange;
  categories: Category[]; // visible (gated by showArchived)
  allCategories: Category[]; // full list for uniqueness checks
  allGoals: Goal[]; // active + retired goal revisions
  onRefreshCategories: () => Promise<void> | void;
  filterCategoryId: number | null;
  onFilterChange: (id: number | null) => void;
  onOpenSettings: () => void;
  // Bumped by App whenever block data changes; we re-fetch totals when it
  // changes so sidebar numbers stay live.
  dataVersion: number;
}

// Stable empty array so categories without goals don't get a fresh prop
// identity every render.
const EMPTY_GOALS: Goal[] = [];

export function Sidebar(props: Props) {
  const {
    view,
    day,
    onDayChange,
    range,
    categories,
    allCategories,
    allGoals,
    onRefreshCategories,
    filterCategoryId,
    onFilterChange,
    onOpenSettings,
    dataVersion,
  } = props;

  // Active goal revisions grouped by category — the goal editor seeds from
  // these.
  const activeGoalsByCategory = useMemo(() => {
    const m = new Map<number, Goal[]>();
    for (const g of allGoals) {
      if (g.retired_from != null) continue;
      const arr = m.get(g.category_id);
      if (arr) arr.push(g);
      else m.set(g.category_id, [g]);
    }
    return m;
  }, [allGoals]);

  const [showPicker, setShowPicker] = useState(false);
  const [newCatOpen, setNewCatOpen] = useState(false);
  const [blocks, setBlocks] = useState<Block[]>([]);

  // load blocks for current view range to compute totals
  useEffect(() => {
    const from =
      view === 'day'
        ? startOfLocalDay(day)
        : view === 'week'
          ? startOfWeek(day)
          : range.from;
    const to =
      view === 'day'
        ? endOfLocalDay(day)
        : view === 'week'
          ? endOfLocalDay(addDays(startOfWeek(day), 6))
          : range.to;
    window.api.blocks
      .listByRange({ from: toIso(from), to: toIso(to) })
      .then(setBlocks)
      .catch(() => setBlocks([]));
  }, [view, day, range.from, range.to, dataVersion]);

  const totalsByCategory = useMemo(() => {
    const m = new Map<number, number>();
    // Plan blocks represent intent, not lived time — exclude them so the
    // sidebar reflects what actually happened. The Aggregate view applies
    // the same filter.
    for (const b of blocks) {
      if (b.kind === 'plan') continue;
      const ms = fromIso(b.end_at).getTime() - fromIso(b.start_at).getTime();
      m.set(b.category_id, (m.get(b.category_id) ?? 0) + ms);
    }
    return m;
  }, [blocks]);

  return (
    <aside className="no-drag w-[220px] shrink-0 h-full border-r border-line flex flex-col bg-bg">
      <div className="px-5 pt-2 pb-4 border-b border-line">
        {view === 'day' ? (
          <DayNav
            day={day}
            onDayChange={onDayChange}
            showPicker={showPicker}
            setShowPicker={setShowPicker}
          />
        ) : view === 'week' ? (
          <WeekNav day={day} onDayChange={onDayChange} />
        ) : (
          <RangeSummary range={range} />
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto py-3">
        <div className="px-5 pb-1 text-[11px] uppercase tracking-wider text-faint">
          Categories
        </div>
        <ul className="px-2 mt-1">
          {categories.length === 0 && (
            <li className="px-3 py-2 text-xs text-faint">
              No categories yet. Add one below.
            </li>
          )}
          {categories.map((c) => (
            <CategoryRow
              key={c.id}
              category={c}
              goals={activeGoalsByCategory.get(c.id) ?? EMPTY_GOALS}
              hours={(totalsByCategory.get(c.id) ?? 0) / 3600000}
              active={filterCategoryId === c.id}
              onClick={() =>
                onFilterChange(filterCategoryId === c.id ? null : c.id)
              }
              onUpdated={onRefreshCategories}
            />
          ))}
        </ul>
        <GoalsPanel
          allCategories={allCategories}
          goals={allGoals}
          dataVersion={dataVersion}
          variant="compact"
        />
      </div>
      <div className="px-3 pb-3 pt-2 border-t border-line flex items-center justify-between gap-2">
        <button
          className="btn-ghost btn flex items-center gap-1.5 text-sm"
          onClick={() => setNewCatOpen(true)}
        >
          <Plus size={14} strokeWidth={1.5} />
          New category
        </button>
        <button
          className="btn-ghost btn p-1.5"
          onClick={onOpenSettings}
          aria-label="Settings"
          title="Settings (⌘,)"
        >
          <SettingsIcon size={15} strokeWidth={1.5} />
        </button>
      </div>
      {newCatOpen && (
        <NewCategoryDialog
          existing={allCategories}
          onClose={() => setNewCatOpen(false)}
          onCreated={async () => {
            setNewCatOpen(false);
            await onRefreshCategories();
          }}
        />
      )}
    </aside>
  );
}

function DayNav({
  day,
  onDayChange,
  showPicker,
  setShowPicker,
}: {
  day: Date;
  onDayChange: (d: Date) => void;
  showPicker: boolean;
  setShowPicker: (b: boolean) => void;
}) {
  const pickerRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (showPicker) pickerRef.current?.focus();
  }, [showPicker]);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <button
          className="btn-ghost btn p-1"
          onClick={() => onDayChange(addDays(day, -1))}
          aria-label="Previous day"
        >
          <ChevronLeft size={15} strokeWidth={1.5} />
        </button>
        <button
          className="btn-ghost btn px-2 py-1 text-sm font-medium"
          onClick={() => onDayChange(new Date())}
          title="Jump to today (T)"
        >
          Today
        </button>
        <button
          className="btn-ghost btn p-1"
          onClick={() => onDayChange(addDays(day, 1))}
          aria-label="Next day"
        >
          <ChevronRight size={15} strokeWidth={1.5} />
        </button>
      </div>
      <div className="mt-2 flex items-center justify-between">
        <div className="text-[19px] font-medium leading-snug tracking-tight">
          {readableDate(day)}
        </div>
        <button
          className="btn-ghost btn p-1"
          onClick={() => setShowPicker(!showPicker)}
          aria-label="Pick date"
          title="Pick a date"
        >
          <Calendar size={15} strokeWidth={1.5} />
        </button>
      </div>
      {showPicker && (
        <input
          ref={pickerRef}
          type="date"
          className="input-bare mt-2 w-full"
          value={isoYmd(day)}
          onChange={(e) => {
            if (e.target.value) onDayChange(fromIsoYmd(e.target.value));
          }}
          onBlur={() => setShowPicker(false)}
        />
      )}
    </div>
  );
}

function WeekNav({
  day,
  onDayChange,
}: {
  day: Date;
  onDayChange: (d: Date) => void;
}) {
  const monday = startOfWeek(day);
  const sunday = addDays(monday, 6);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <button
          className="btn-ghost btn p-1"
          onClick={() => onDayChange(addDays(day, -7))}
          aria-label="Previous week"
        >
          <ChevronLeft size={15} strokeWidth={1.5} />
        </button>
        <button
          className="btn-ghost btn px-2 py-1 text-sm font-medium"
          onClick={() => onDayChange(new Date())}
          title="Jump to this week (T)"
        >
          This week
        </button>
        <button
          className="btn-ghost btn p-1"
          onClick={() => onDayChange(addDays(day, 7))}
          aria-label="Next week"
        >
          <ChevronRight size={15} strokeWidth={1.5} />
        </button>
      </div>
      <div className="mt-2">
        <div className="text-[11px] uppercase tracking-wider text-faint">
          Week of
        </div>
        <div className="text-[17px] font-medium leading-snug tracking-tight mt-0.5">
          {shortDate(monday)}
        </div>
        <div className="text-sm text-muted">→ {shortDate(sunday)}</div>
      </div>
    </div>
  );
}

function RangeSummary({ range }: { range: DateRange }) {
  return (
    <div className="flex flex-col">
      <div className="text-[11px] uppercase tracking-wider text-faint">
        {range.presetLabel ?? 'Range'}
      </div>
      <div className="text-[19px] font-medium leading-snug tracking-tight mt-1">
        {shortDate(range.from)}
      </div>
      <div className="text-sm text-muted">→ {shortDate(range.to)}</div>
      <div className="mt-1 text-xs text-faint">
        {Math.max(
          1,
          Math.ceil(
            (range.to.getTime() - range.from.getTime()) / (24 * 60 * 60 * 1000)
          )
        )}{' '}
        days
      </div>
    </div>
  );
}
