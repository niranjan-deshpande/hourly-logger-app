import type { Block, Category, Goal, GoalExemption, ID } from '@shared/types';
import { addDays, fromIso, isoYmd, startOfLocalDay } from './time';

// Goal progress is computed, never stored. Goals live in their own
// effective-dated table (v8): a weekly minutes target reads this week's
// actual blocks; a habit reads which local days have at least one actual
// block. Plan blocks never count (same rule as all stats); pomodoro breaks
// count because they live inside the block. Exemptions mark a day exempt
// for a habit so it doesn't break streaks.

export interface WeeklyGoalProgress {
  category: Category;
  targetMinutes: number;
  doneMs: number;
  // Mon..Sun contribution for the current week, clipped to day bounds
  // so a block crossing midnight is split between its days.
  byDayMs: number[];
  todayIndex: number; // 0 = Monday
}

// A day cell in the 14-day strip: an actual block that day ('done'), an
// exemption with no block ('excused'), or neither ('missed'). Done wins.
export type HabitDay = 'done' | 'excused' | 'missed';

export interface HabitProgress {
  category: Category;
  kind: 'daily_habit' | 'weekly_frequency';
  doneToday: boolean;
  excusedToday: boolean;
  // Days for a daily habit; whole (Monday-start) weeks for a frequency
  // habit. An unfinished today (or week) never breaks it.
  streak: number;
  // Last 14 days, oldest first; for the strip in the full panel.
  recentDays: HabitDay[];
  // Frequency habits only (a daily habit reports target 1, doneThisWeek 0,
  // effectiveTarget 1): days/week target, distinct done days this week, and
  // the target reduced by this week's excused-only days.
  target: number;
  doneThisWeek: number;
  effectiveTarget: number;
}

// Monday-start week, matching the rest of the app.
export function mondayOf(d: Date): Date {
  const offset = (d.getDay() + 6) % 7;
  return startOfLocalDay(addDays(d, -offset));
}

function overlapMs(b: Block, from: Date, to: Date): number {
  const s = Math.max(fromIso(b.start_at).getTime(), from.getTime());
  const e = Math.min(fromIso(b.end_at).getTime(), to.getTime());
  return Math.max(0, e - s);
}

export function computeWeeklyGoals(
  blocks: Block[],
  categories: Category[],
  goals: Goal[],
  now: Date = new Date()
): WeeklyGoalProgress[] {
  // A category has a weekly goal iff it has an ACTIVE weekly_minutes
  // revision (retired_from == null) and isn't archived.
  const active = new Map<ID, Goal>();
  for (const g of goals) {
    if (g.kind === 'weekly_minutes' && g.retired_from == null) {
      active.set(g.category_id, g);
    }
  }
  const goalCats = categories.filter((c) => !c.archived && active.has(c.id));
  if (goalCats.length === 0) return [];

  const weekStart = mondayOf(now);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const todayIndex = Math.min(
    6,
    Math.max(
      0,
      Math.round(
        (startOfLocalDay(now).getTime() - weekStart.getTime()) / 86400000
      )
    )
  );

  return goalCats.map((category) => {
    const byDayMs = days.map((dayStart) => {
      const dayEnd = addDays(dayStart, 1);
      let ms = 0;
      for (const b of blocks) {
        if (b.kind === 'plan' || b.category_id !== category.id) continue;
        ms += overlapMs(b, dayStart, dayEnd);
      }
      return ms;
    });
    return {
      category,
      // Effective dating for current-week progress just uses the active
      // row's target (no proration mid-week).
      targetMinutes: active.get(category.id)!.target,
      doneMs: byDayMs.reduce((a, b) => a + b, 0),
      byDayMs,
      todayIndex,
    };
  });
}

export function computeHabits(
  blocks: Block[],
  categories: Category[],
  goals: Goal[],
  exemptions: GoalExemption[],
  now: Date = new Date()
): HabitProgress[] {
  // Active habit-kind revision per category (daily_habit OR
  // weekly_frequency; at most one active by construction).
  const activeHabit = new Map<ID, Goal>();
  for (const g of goals) {
    if (
      (g.kind === 'daily_habit' || g.kind === 'weekly_frequency') &&
      g.retired_from == null
    ) {
      activeHabit.set(g.category_id, g);
    }
  }
  const habitCats = categories.filter(
    (c) => !c.archived && activeHabit.has(c.id)
  );
  if (habitCats.length === 0) return [];

  // Exemptions grouped by category → set of local YYYY-MM-DD.
  const exemptByCat = new Map<ID, Set<string>>();
  for (const e of exemptions) {
    let s = exemptByCat.get(e.category_id);
    if (!s) exemptByCat.set(e.category_id, (s = new Set()));
    s.add(e.date);
  }

  const today = startOfLocalDay(now);

  return habitCats.map((category) => {
    const goal = activeHabit.get(category.id)!;
    // Every local day an actual block touches counts as "done".
    const daysDone = new Set<string>();
    for (const b of blocks) {
      if (b.kind === 'plan' || b.category_id !== category.id) continue;
      let d = startOfLocalDay(fromIso(b.start_at));
      const endMs = fromIso(b.end_at).getTime();
      while (d.getTime() < endMs) {
        daysDone.add(isoYmd(d));
        d = addDays(d, 1);
      }
    }
    const exempt = exemptByCat.get(category.id) ?? new Set<string>();

    const dayState = (ymd: string): HabitDay =>
      daysDone.has(ymd) ? 'done' : exempt.has(ymd) ? 'excused' : 'missed';

    const doneToday = daysDone.has(isoYmd(today));
    const excusedToday = exempt.has(isoYmd(today));

    const recentDays: HabitDay[] = Array.from({ length: 14 }, (_, i) =>
      dayState(isoYmd(addDays(today, i - 13)))
    );

    if (goal.kind === 'daily_habit') {
      // Walk back from today (or yesterday if today isn't done — an
      // unfinished, or excused-and-not-done, today never breaks a streak).
      // `done` increments; `excused` is skipped without incrementing;
      // `missed` stops.
      let streak = 0;
      let cursor = doneToday ? today : addDays(today, -1);
      for (;;) {
        const ymd = isoYmd(cursor);
        if (daysDone.has(ymd)) {
          streak++;
        } else if (exempt.has(ymd)) {
          // skip, no increment
        } else {
          break;
        }
        cursor = addDays(cursor, -1);
      }
      return {
        category,
        kind: 'daily_habit',
        doneToday,
        excusedToday,
        streak,
        recentDays,
        target: 1,
        doneThisWeek: 0,
        effectiveTarget: 1,
      };
    }

    // --- weekly_frequency ---
    // For a Monday-start week: doneDays = distinct done days; excusedOnly =
    // exempted days not also done; effectiveTarget = max(0, target −
    // |excusedOnly|); the week is met iff |doneDays| ≥ effectiveTarget.
    const weekStats = (weekStart: Date, target: number) => {
      let done = 0;
      let excusedOnly = 0;
      for (let i = 0; i < 7; i++) {
        const ymd = isoYmd(addDays(weekStart, i));
        if (daysDone.has(ymd)) done++;
        else if (exempt.has(ymd)) excusedOnly++;
      }
      const eff = Math.max(0, target - excusedOnly);
      return { done, eff, met: done >= eff };
    };
    // The frequency revision covering a given week's Monday (by local day
    // string), or null if none covers it (stops the streak walk).
    const coveringTarget = (mondayYmd: string): number | null => {
      for (const g of goals) {
        if (
          g.category_id === category.id &&
          g.kind === 'weekly_frequency' &&
          g.effective_from <= mondayYmd &&
          (g.retired_from == null || mondayYmd < g.retired_from)
        ) {
          return g.target;
        }
      }
      return null;
    };

    const thisMonday = mondayOf(now);
    const cur = weekStats(thisMonday, goal.target);

    // Include the current week only if already met; then walk back while
    // each prior week is met, scoring it against the revision covering its
    // Monday. An unfinished current week never breaks the streak.
    let streak = cur.met ? 1 : 0;
    let ws = addDays(thisMonday, -7);
    for (;;) {
      const t = coveringTarget(isoYmd(ws));
      if (t == null) break;
      if (!weekStats(ws, t).met) break;
      streak++;
      ws = addDays(ws, -7);
    }

    return {
      category,
      kind: 'weekly_frequency',
      doneToday,
      excusedToday,
      streak,
      recentDays,
      target: goal.target,
      doneThisWeek: cur.done,
      effectiveTarget: cur.eff,
    };
  });
}
