import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Block, Category, Goal, GoalExemption } from '@shared/types';
import { addDays, isoYmd, startOfLocalDay, toIso } from '../lib/time';
import {
  computeHabits,
  computeWeeklyGoals,
  mondayOf,
  type HabitDay,
  type HabitProgress,
  type WeeklyGoalProgress,
} from '../lib/goals';
import { withAlpha } from '../lib/colors';

// Goal progress, rendered in two densities: 'compact' lives in the
// sidebar (always visible while you work), 'full' sits at the top of
// the Aggregate view with per-day bars and a 14-day habit strip. The
// panel fetches its own blocks + exemptions (back far enough for streaks)
// and renders nothing when no category has an active goal. In the 'full'
// variant the habit strip cells are clickable to excuse/unexcuse a day.

// Streak lookback. A year of blocks is a trivial query for SQLite; the
// cap just bounds the IPC payload.
const LOOKBACK_DAYS = 400;

interface Props {
  allCategories: Category[];
  goals: Goal[]; // active + retired revisions
  dataVersion: number;
  variant: 'compact' | 'full';
}

export function GoalsPanel({ allCategories, goals, dataVersion, variant }: Props) {
  const hasGoals = useMemo(() => {
    const activeCatIds = new Set(
      goals.filter((g) => g.retired_from == null).map((g) => g.category_id)
    );
    return allCategories.some((c) => !c.archived && activeCatIds.has(c.id));
  }, [goals, allCategories]);

  const [blocks, setBlocks] = useState<Block[]>([]);
  const [exemptions, setExemptions] = useState<GoalExemption[]>([]);
  // Re-evaluate "today" every few minutes so streaks/today flip at
  // midnight without a restart.
  const [nowTick, setNowTick] = useState(0);
  // Bumped on a local excuse toggle to refetch exemptions without a
  // block-data (dataVersion) round trip.
  const [exVersion, setExVersion] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setNowTick((n) => n + 1), 5 * 60 * 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!hasGoals) {
      setBlocks([]);
      return;
    }
    const now = new Date();
    const from = addDays(startOfLocalDay(now), -LOOKBACK_DAYS);
    const to = addDays(mondayOf(now), 7); // end of the current week
    window.api.blocks
      .listByRange({ from: toIso(from), to: toIso(to) })
      .then(setBlocks)
      .catch(() => setBlocks([]));
  }, [hasGoals, dataVersion, nowTick]);

  useEffect(() => {
    if (!hasGoals) {
      setExemptions([]);
      return;
    }
    const now = new Date();
    const from = addDays(startOfLocalDay(now), -LOOKBACK_DAYS);
    const to = addDays(mondayOf(now), 7);
    window.api.goals
      .listExemptions({ from: isoYmd(from), to: isoYmd(to) })
      .then(setExemptions)
      .catch(() => setExemptions([]));
  }, [hasGoals, dataVersion, nowTick, exVersion]);

  const weekly = useMemo(
    () => computeWeeklyGoals(blocks, allCategories, goals),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [blocks, allCategories, goals, nowTick]
  );
  const habits = useMemo(
    () => computeHabits(blocks, allCategories, goals, exemptions),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [blocks, allCategories, goals, exemptions, nowTick]
  );

  const compact = variant === 'compact';

  // Excusing is a full-variant affordance only; the compact strip is
  // non-interactive.
  const onToggleExempt = useMemo(() => {
    if (compact) return undefined;
    return async (categoryId: number, date: string, excused: boolean) => {
      try {
        await window.api.goals.setExemption({ categoryId, date, excused });
        setExVersion((v) => v + 1);
      } catch {
        // ignore — the strip stays as-is
      }
    };
  }, [compact]);

  if (weekly.length === 0 && habits.length === 0) return null;

  return (
    <div className={compact ? 'px-5 pt-4' : 'mb-6'}>
      <div className="pb-1 text-[11px] uppercase tracking-wider text-faint">
        Goals · this week
      </div>
      <div className={compact ? 'mt-1 space-y-3' : 'mt-2 space-y-4'}>
        {weekly.map((g) => (
          <WeeklyGoalRow key={g.category.id} goal={g} compact={compact} />
        ))}
        {habits.map((h) => (
          <HabitRow
            key={h.category.id}
            habit={h}
            compact={compact}
            onToggleExempt={onToggleExempt}
          />
        ))}
      </div>
    </div>
  );
}

function WeeklyGoalRow({
  goal,
  compact,
}: {
  goal: WeeklyGoalProgress;
  compact: boolean;
}) {
  const { category, targetMinutes, doneMs, byDayMs, todayIndex } = goal;
  const targetMs = targetMinutes * 60000;
  const fraction = Math.min(1, doneMs / targetMs);
  const done = doneMs >= targetMs;

  // Pace: hours per remaining day (incl. today) to land the target.
  const daysLeft = 7 - todayIndex;
  const remainingMs = Math.max(0, targetMs - doneMs);
  const needPerDayH = remainingMs / daysLeft / 3600000;

  // Day cells scale against the busiest day or an even split of the
  // target, whichever is larger — keeps quiet days visibly quiet.
  const dayScale = Math.max(...byDayMs, targetMs / 7, 1);

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ background: category.color }}
            aria-hidden
          />
          <span className="text-xs truncate">{category.name}</span>
        </div>
        <span className="text-[11px] tabular-nums text-muted shrink-0">
          {hours1(doneMs)} / {hours1(targetMs)}h{done ? ' ✓' : ''}
        </span>
      </div>
      <div
        className="mt-1 h-1.5 rounded-full overflow-hidden"
        style={{ background: 'var(--hover)' }}
        role="progressbar"
        aria-valuenow={Math.round(fraction * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="h-full rounded-full"
          style={{
            width: `${fraction * 100}%`,
            background: category.color,
            transition: 'width 300ms ease',
          }}
        />
      </div>
      <div className="mt-1 flex items-end gap-[3px]" aria-hidden>
        {byDayMs.map((ms, i) => (
          <div
            key={i}
            className="flex-1 rounded-[2px]"
            title={`${'MTWTFSS'[i]} · ${hours1(ms)}h`}
            style={{
              height: compact ? 8 : 18,
              background:
                ms > 0
                  ? withAlpha(category.color, 0.25 + 0.75 * Math.min(1, ms / dayScale))
                  : 'var(--hover)',
              outline: i === todayIndex ? `1px solid ${category.color}` : 'none',
              outlineOffset: 1,
              opacity: i > todayIndex ? 0.45 : 1,
            }}
          />
        ))}
      </div>
      {!compact && !done && (
        <div className="mt-1 text-[10.5px] text-faint tabular-nums">
          needs ~{needPerDayH.toFixed(1)}h/day over the next {daysLeft}{' '}
          day{daysLeft === 1 ? '' : 's'}
        </div>
      )}
    </div>
  );
}

function HabitRow({
  habit,
  compact,
  onToggleExempt,
}: {
  habit: HabitProgress;
  compact: boolean;
  onToggleExempt?: (
    categoryId: number,
    date: string,
    excused: boolean
  ) => void | Promise<void>;
}) {
  const {
    category,
    kind,
    doneToday,
    excusedToday,
    streak,
    recentDays,
    target,
    doneThisWeek,
    effectiveTarget,
  } = habit;
  const isFreq = kind === 'weekly_frequency';
  const tag = isFreq ? `${target}×/wk` : 'daily';
  const streakText = isFreq
    ? streak > 0
      ? `${streak} wk`
      : '—'
    : streak > 0
      ? `${streak} day${streak === 1 ? '' : 's'}`
      : '—';
  const todayLabel = doneToday ? '✓ today' : excusedToday ? 'excused' : 'not yet';

  const today = startOfLocalDay(new Date());

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ background: category.color }}
            aria-hidden
          />
          <span className="text-xs truncate">{category.name}</span>
          <span className="text-[10.5px] text-faint shrink-0">{tag}</span>
        </div>
        <span className="text-[11px] tabular-nums text-muted shrink-0">
          {isFreq ? (
            <>
              {doneThisWeek}/{effectiveTarget} this wk
              <span className="text-faint"> · {streakText}</span>
            </>
          ) : (
            <>
              {streakText}
              <span className={doneToday || excusedToday ? '' : 'opacity-40'}>
                {' '}
                · {todayLabel}
              </span>
            </>
          )}
        </span>
      </div>
      {!compact && (
        <div className="mt-1 flex items-center gap-[3px]">
          {recentDays.map((state, i) => {
            const date = addDays(today, i - 13);
            return (
              <HabitCell
                key={i}
                state={state}
                color={category.color}
                date={date}
                onToggle={
                  onToggleExempt
                    ? () =>
                        onToggleExempt(
                          category.id,
                          isoYmd(date),
                          state !== 'excused'
                        )
                    : undefined
                }
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

// One day in the 14-day strip. 'done' = solid; 'missed' = empty; 'excused'
// = a hollow ring in the category color (clearly "neither done nor missed"
// in both themes). In the full variant a missed/excused cell is a button
// that toggles the day's exemption; done cells are never clickable.
function HabitCell({
  state,
  color,
  date,
  onToggle,
}: {
  state: HabitDay;
  color: string;
  date: Date;
  onToggle?: () => void;
}) {
  const weekday = date.toLocaleDateString([], { weekday: 'short' });
  const style: React.CSSProperties = {
    height: 8,
    borderRadius: 2,
    background:
      state === 'done' ? withAlpha(color, 0.8) : state === 'excused' ? 'transparent' : 'var(--hover)',
    boxShadow: state === 'excused' ? `inset 0 0 0 1.5px ${withAlpha(color, 0.6)}` : undefined,
  };
  const clickable = onToggle && state !== 'done';
  const title = clickable
    ? state === 'excused'
      ? `${weekday} · excused — click to unexcuse`
      : `${weekday} · missed — click to excuse`
    : state === 'done'
      ? `${weekday} · done`
      : state === 'excused'
        ? `${weekday} · excused`
        : `${weekday} · missed`;

  if (clickable) {
    return (
      <button
        type="button"
        className="flex-1"
        style={{ ...style, padding: 0, border: 'none', cursor: 'pointer' }}
        title={title}
        onClick={onToggle}
      />
    );
  }
  return <span className="flex-1" style={style} title={title} aria-hidden />;
}

function hours1(ms: number): string {
  const h = ms / 3600000;
  return (Math.round(h * 10) / 10).toString();
}
