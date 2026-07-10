import { useEffect, useMemo, useState } from 'react';
import type { Block, Category, Goal } from '@shared/types';
import {
  addDays,
  endOfLocalDay,
  formatDuration,
  fromIsoYmd,
  isoYmd,
  shortDate,
  startOfLocalDay,
  toIso,
} from '../lib/time';
import { computeStats, totalMs } from '../lib/aggregate';
import { withAlpha } from '../lib/colors';
import { GoalsPanel } from '../components/GoalsPanel';
import type { DateRange } from '../App';

interface Props {
  range: DateRange;
  onRangeChange: (r: DateRange) => void;
  // Full category list (incl. archived) — archived categories may still have
  // historical blocks that need to be counted in the aggregate view.
  allCategories: Category[];
  allGoals: Goal[];
  filterCategoryId: number | null;
  dataVersion: number;
}

type SortKey = 'name' | 'total' | 'sessions' | 'avg' | 'longest';

interface Preset {
  key: string;
  label: string;
  make: () => { from: Date; to: Date };
}

// Exported so App-level keyboard shortcuts (←/→ in the Aggregate view)
// can step through the same panes the toolbar shows, in display order.
export const PRESETS: Preset[] = [
  {
    key: 'today',
    label: 'Today',
    make: () => ({ from: startOfLocalDay(new Date()), to: endOfLocalDay(new Date()) }),
  },
  {
    key: 'yesterday',
    label: 'Yesterday',
    make: () => {
      const y = addDays(new Date(), -1);
      return { from: startOfLocalDay(y), to: endOfLocalDay(y) };
    },
  },
  { key: 'thisWeek', label: 'This week', make: () => weekRange(new Date()) },
  { key: 'lastWeek', label: 'Last week', make: () => weekRange(addDays(new Date(), -7)) },
  {
    key: 'last7',
    label: 'Last 7 days',
    make: () => ({
      from: startOfLocalDay(addDays(new Date(), -6)),
      to: endOfLocalDay(new Date()),
    }),
  },
  {
    key: 'thisMonth',
    label: 'This month',
    make: () => {
      const now = new Date();
      return {
        from: startOfLocalDay(new Date(now.getFullYear(), now.getMonth(), 1)),
        to: endOfLocalDay(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
      };
    },
  },
  {
    key: 'lastMonth',
    label: 'Last month',
    make: () => {
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 0);
      return { from: startOfLocalDay(start), to: endOfLocalDay(end) };
    },
  },
  {
    key: 'all',
    label: 'All time',
    make: () => ({
      from: new Date(2000, 0, 1),
      to: endOfLocalDay(new Date()),
    }),
  },
];

const PRESET_LABEL_TO_KEY: Record<string, string> = Object.fromEntries(
  PRESETS.map((p) => [p.label, p.key])
);

function weekRange(d: Date) {
  const day = d.getDay();
  const offset = (day + 6) % 7;
  const monday = startOfLocalDay(addDays(d, -offset));
  const sunday = endOfLocalDay(addDays(monday, 6));
  return { from: monday, to: sunday };
}

export function AggregateView({
  range,
  onRangeChange,
  allCategories,
  allGoals,
  filterCategoryId,
  dataVersion,
}: Props) {
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>('total');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [hoverCategory, setHoverCategory] = useState<number | null>(null);

  const activePreset = range.presetLabel
    ? PRESET_LABEL_TO_KEY[range.presetLabel] ?? null
    : null;
  const customMode = activePreset === null;

  useEffect(() => {
    window.api.blocks
      .listByRange({ from: toIso(range.from), to: toIso(range.to) })
      .then(setBlocks)
      .catch(() => setBlocks([]));
  }, [range.from, range.to, dataVersion]);

  function pickPreset(key: string) {
    const p = PRESETS.find((x) => x.key === key);
    if (!p) return;
    const r = p.make();
    onRangeChange({ from: r.from, to: r.to, presetLabel: p.label });
  }

  const filteredBlocks = useMemo(
    () =>
      filterCategoryId == null
        ? blocks
        : blocks.filter((b) => b.category_id === filterCategoryId),
    [blocks, filterCategoryId]
  );

  const stats = useMemo(() => {
    const cats =
      filterCategoryId == null
        ? allCategories
        : allCategories.filter((c) => c.id === filterCategoryId);
    return computeStats(filteredBlocks, cats).filter((s) => s.totalMs > 0);
  }, [filteredBlocks, allCategories, filterCategoryId]);

  const total = totalMs(stats);

  const sortedForBar = useMemo(
    () => [...stats].sort((a, b) => b.totalMs - a.totalMs),
    [stats]
  );

  const sortedForTable = useMemo(() => {
    const arr = [...stats];
    arr.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'name':
          cmp = a.category.name.localeCompare(b.category.name);
          break;
        case 'total':
          cmp = a.totalMs - b.totalMs;
          break;
        case 'sessions':
          cmp = a.sessions - b.sessions;
          break;
        case 'avg':
          cmp = a.avgMs - b.avgMs;
          break;
        case 'longest':
          cmp = a.longestMs - b.longestMs;
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [stats, sortKey, sortDir]);

  function toggleSort(k: SortKey) {
    if (sortKey === k) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(k);
      setSortDir(k === 'name' ? 'asc' : 'desc');
    }
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto px-6 py-4">
      <div className="flex items-center gap-1.5 flex-wrap">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            className={`tag-pill ${activePreset === p.key ? 'active' : ''}`}
            onClick={() => pickPreset(p.key)}
          >
            {p.label}
          </button>
        ))}
        <button
          className={`tag-pill ${customMode ? 'active' : ''}`}
          onClick={() => {
            // Strip the preset label so subsequent date-input changes don't
            // get re-attached to a preset.
            onRangeChange({ from: range.from, to: range.to });
          }}
        >
          Custom
        </button>
      </div>

      {customMode && (
        <div className="mt-3 flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted">From</span>
            <input
              type="date"
              className="input-bare"
              value={isoYmd(range.from)}
              onChange={(e) => {
                if (e.target.value)
                  onRangeChange({
                    from: startOfLocalDay(fromIsoYmd(e.target.value)),
                    to: range.to,
                  });
              }}
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted">To</span>
            <input
              type="date"
              className="input-bare"
              value={isoYmd(range.to)}
              onChange={(e) => {
                if (e.target.value)
                  onRangeChange({
                    from: range.from,
                    to: endOfLocalDay(fromIsoYmd(e.target.value)),
                  });
              }}
            />
          </div>
        </div>
      )}

      <div className="mt-3 text-xs text-faint">
        {shortDate(range.from)} – {shortDate(range.to)} · {formatDuration(total)} total
      </div>

      {/* Goals: always the CURRENT week/streaks, independent of the
          selected range — "how am I doing right now" doesn't change
          when you go look at last month. */}
      <div className="mt-6">
        <GoalsPanel
          allCategories={allCategories}
          goals={allGoals}
          dataVersion={dataVersion}
          variant="full"
        />
      </div>

      {/* Stacked bar */}
      <div className="mt-6">
        <div
          className="h-10 w-full rounded-md overflow-hidden flex border border-line surface-card"
          style={{ background: 'transparent' }}
          onMouseLeave={() => setHoverCategory(null)}
        >
          {sortedForBar.length === 0 && (
            <div className="flex-1 flex items-center justify-center text-xs text-faint">
              Nothing in this range yet.
            </div>
          )}
          {sortedForBar.map((s) => {
            const pct = total > 0 ? (s.totalMs / total) * 100 : 0;
            const dim = hoverCategory != null && hoverCategory !== s.category.id;
            return (
              <div
                key={s.category.id}
                onMouseEnter={() => setHoverCategory(s.category.id)}
                className="h-full flex items-center justify-center text-[11px] whitespace-nowrap overflow-hidden transition-opacity"
                style={{
                  width: `${pct}%`,
                  background: withAlpha(s.category.color, 0.55),
                  color: 'var(--ink)',
                  opacity: dim ? 0.35 : 1,
                  borderRight: '1px solid var(--bg)',
                }}
                title={`${s.category.name} · ${formatDuration(s.totalMs)} · ${pct.toFixed(
                  1
                )}%`}
              >
                {pct > 8 ? (
                  <span className="px-1 truncate">
                    {s.category.name} · {pct.toFixed(0)}%
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
        <div className="mt-2 flex items-center flex-wrap gap-3 text-[11px] text-muted">
          {sortedForBar.map((s) => (
            <div
              key={s.category.id}
              className="flex items-center gap-1.5"
              onMouseEnter={() => setHoverCategory(s.category.id)}
              onMouseLeave={() => setHoverCategory(null)}
            >
              <span
                className="w-2 h-2 rounded-full"
                style={{ background: s.category.color }}
              />
              <span>{s.category.name}</span>
              <span className="text-faint tabular-nums">
                {formatDuration(s.totalMs)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="mt-8 surface-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wider text-faint border-b border-line">
              <ThCell label="Category" k="name" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="left" />
              <ThCell label="Total" k="total" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
              <ThCell label="Sessions" k="sessions" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
              <ThCell label="Avg" k="avg" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
              <ThCell label="Longest" k="longest" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
            </tr>
          </thead>
          <tbody>
            {sortedForTable.map((s) => (
              <tr key={s.category.id} className="border-b border-line last:border-0">
                <td className="px-4 py-2">
                  <span className="flex items-center gap-2">
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{ background: s.category.color }}
                    />
                    <span>{s.category.name}</span>
                  </span>
                </td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {formatDuration(s.totalMs)}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {s.sessions}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-muted">
                  {formatDuration(s.avgMs)}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-muted">
                  {formatDuration(s.longestMs)}
                </td>
              </tr>
            ))}
            {sortedForTable.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-xs text-faint">
                  Nothing logged in this range.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ThCell({
  label,
  k,
  sortKey,
  sortDir,
  onClick,
  align,
}: {
  label: string;
  k: SortKey;
  sortKey: SortKey;
  sortDir: 'asc' | 'desc';
  onClick: (k: SortKey) => void;
  align: 'left' | 'right';
}) {
  const active = sortKey === k;
  return (
    <th
      className={`px-4 py-2 font-normal cursor-pointer select-none ${
        align === 'right' ? 'text-right' : 'text-left'
      }`}
      onClick={() => onClick(k)}
    >
      <span className={active ? 'text-ink' : ''}>
        {label}
        {active && (sortDir === 'asc' ? ' ↑' : ' ↓')}
      </span>
    </th>
  );
}
