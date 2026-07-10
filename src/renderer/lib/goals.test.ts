import { describe, it, expect } from 'vitest';
import type { Block, Category, Goal, GoalExemption } from '@shared/types';
import { computeHabits, computeWeeklyGoals } from './goals';

function cat(id: number, name = `cat${id}`): Category {
  return {
    id,
    name,
    color: '#B0512F',
    archived: false,
    created_at: '2020-01-01T00:00:00.000Z',
  };
}

let goalId = 1;
function goal(partial: Partial<Goal> & Pick<Goal, 'category_id' | 'kind' | 'target'>): Goal {
  return {
    id: goalId++,
    effective_from: '1970-01-01',
    retired_from: null,
    created_at: '2020-01-01T00:00:00.000Z',
    ...partial,
  };
}

// A block spanning a local day (or explicit local times) for a category.
function block(categoryId: number, start: Date, end: Date, kind: 'plan' | 'actual' = 'actual'): Block {
  return {
    id: Math.floor(Math.random() * 1e9),
    category_id: categoryId,
    start_at: start.toISOString(),
    end_at: end.toISOString(),
    note: null,
    kind,
    external_source: null,
    external_id: null,
    detached: false,
    pomodoro: null,
    created_at: start.toISOString(),
    updated_at: start.toISOString(),
  };
}

// A same-day actual block (10:00–11:00 local) on the given local Y/M/D.
function dayBlock(categoryId: number, y: number, m: number, d: number): Block {
  return block(categoryId, new Date(y, m - 1, d, 10, 0), new Date(y, m - 1, d, 11, 0));
}

function exempt(categoryId: number, date: string): GoalExemption {
  return { category_id: categoryId, date };
}

// --- Daily habit streaks ---

describe('computeHabits — daily habit', () => {
  // "Now" = Wed 2026-06-24, late enough to be past all blocks.
  const NOW = new Date(2026, 5, 24, 20, 0);

  it('counts a plain consecutive streak ending today', () => {
    const cats = [cat(1)];
    const goals = [goal({ category_id: 1, kind: 'daily_habit', target: 1 })];
    const blocks = [
      dayBlock(1, 2026, 6, 22),
      dayBlock(1, 2026, 6, 23),
      dayBlock(1, 2026, 6, 24),
    ];
    const [h] = computeHabits(blocks, cats, goals, [], NOW);
    expect(h.doneToday).toBe(true);
    expect(h.streak).toBe(3);
  });

  it('excused days are skipped without incrementing: done,done,excused,done ⇒ 3', () => {
    const cats = [cat(1)];
    const goals = [goal({ category_id: 1, kind: 'daily_habit', target: 1 })];
    // today=24 done, 23 done, 22 excused (no block), 21 done, 20 missed.
    const blocks = [
      dayBlock(1, 2026, 6, 24),
      dayBlock(1, 2026, 6, 23),
      dayBlock(1, 2026, 6, 21),
    ];
    const exemptions = [exempt(1, '2026-06-22')];
    const [h] = computeHabits(blocks, cats, goals, exemptions, NOW);
    expect(h.streak).toBe(3);
  });

  it('an unfinished today does not break the streak (walks from yesterday)', () => {
    const cats = [cat(1)];
    const goals = [goal({ category_id: 1, kind: 'daily_habit', target: 1 })];
    // No block today (24); 23,22 done.
    const blocks = [dayBlock(1, 2026, 6, 23), dayBlock(1, 2026, 6, 22)];
    const [h] = computeHabits(blocks, cats, goals, [], NOW);
    expect(h.doneToday).toBe(false);
    expect(h.streak).toBe(2);
  });

  it('an excused-and-not-done today does not break the streak', () => {
    const cats = [cat(1)];
    const goals = [goal({ category_id: 1, kind: 'daily_habit', target: 1 })];
    const blocks = [dayBlock(1, 2026, 6, 23), dayBlock(1, 2026, 6, 22)];
    const exemptions = [exempt(1, '2026-06-24')];
    const [h] = computeHabits(blocks, cats, goals, exemptions, NOW);
    expect(h.excusedToday).toBe(true);
    expect(h.doneToday).toBe(false);
    expect(h.streak).toBe(2);
  });

  it('a missed day stops the walk', () => {
    const cats = [cat(1)];
    const goals = [goal({ category_id: 1, kind: 'daily_habit', target: 1 })];
    // today done, yesterday missed, 22 done — streak is just today.
    const blocks = [dayBlock(1, 2026, 6, 24), dayBlock(1, 2026, 6, 22)];
    const [h] = computeHabits(blocks, cats, goals, [], NOW);
    expect(h.streak).toBe(1);
  });

  it('plan blocks never count', () => {
    const cats = [cat(1)];
    const goals = [goal({ category_id: 1, kind: 'daily_habit', target: 1 })];
    const blocks = [
      block(1, new Date(2026, 5, 24, 10), new Date(2026, 5, 24, 11), 'plan'),
    ];
    const [h] = computeHabits(blocks, cats, goals, [], NOW);
    expect(h.doneToday).toBe(false);
    expect(h.streak).toBe(0);
  });

  it('a block crossing midnight marks both local days done', () => {
    const cats = [cat(1)];
    const goals = [goal({ category_id: 1, kind: 'daily_habit', target: 1 })];
    // 23:30 on the 23rd to 00:30 on the 24th.
    const blocks = [block(1, new Date(2026, 5, 23, 23, 30), new Date(2026, 5, 24, 0, 30))];
    const [h] = computeHabits(blocks, cats, goals, [], NOW);
    expect(h.doneToday).toBe(true); // the 24th
    expect(h.streak).toBe(2); // 24 + 23
  });

  it('produces a 14-entry tri-state strip, oldest first', () => {
    const cats = [cat(1)];
    const goals = [goal({ category_id: 1, kind: 'daily_habit', target: 1 })];
    const blocks = [dayBlock(1, 2026, 6, 24)];
    const exemptions = [exempt(1, '2026-06-23')];
    const [h] = computeHabits(blocks, cats, goals, exemptions, NOW);
    expect(h.recentDays).toHaveLength(14);
    expect(h.recentDays[13]).toBe('done'); // today (24)
    expect(h.recentDays[12]).toBe('excused'); // yesterday (23)
    expect(h.recentDays[0]).toBe('missed'); // 14 days ago
  });
});

// --- Weekly frequency habit ---

describe('computeHabits — weekly frequency', () => {
  // NOW = Wed 2026-06-24. Its Monday is 2026-06-22.
  const NOW = new Date(2026, 5, 24, 20, 0);

  it('reports doneThisWeek and reports met when the target is reached', () => {
    const cats = [cat(1)];
    const goals = [goal({ category_id: 1, kind: 'weekly_frequency', target: 2 })];
    // Mon 22 + Tue 23 done → 2 distinct days, target 2 → met.
    const blocks = [dayBlock(1, 2026, 6, 22), dayBlock(1, 2026, 6, 23)];
    const [h] = computeHabits(blocks, cats, goals, [], NOW);
    expect(h.doneThisWeek).toBe(2);
    expect(h.effectiveTarget).toBe(2);
    expect(h.streak).toBe(1); // current week met
  });

  it('an unmet current week does not count toward the streak', () => {
    const cats = [cat(1)];
    const goals = [goal({ category_id: 1, kind: 'weekly_frequency', target: 3 })];
    const blocks = [dayBlock(1, 2026, 6, 22)]; // only 1 of 3
    const [h] = computeHabits(blocks, cats, goals, [], NOW);
    expect(h.doneThisWeek).toBe(1);
    expect(h.streak).toBe(0);
  });

  it('excused-only days reduce the effective target; excused+done does not', () => {
    const cats = [cat(1)];
    const goals = [goal({ category_id: 1, kind: 'weekly_frequency', target: 4 })];
    // Mon 22 done. Tue 23 excused-only. Wed 24 done AND excused.
    const blocks = [dayBlock(1, 2026, 6, 22), dayBlock(1, 2026, 6, 24)];
    const exemptions = [exempt(1, '2026-06-23'), exempt(1, '2026-06-24')];
    const [h] = computeHabits(blocks, cats, goals, exemptions, NOW);
    // done = {22,24} = 2. excusedOnly = {23} = 1 (24 is done, not excused-only).
    // effectiveTarget = 4 - 1 = 3.
    expect(h.doneThisWeek).toBe(2);
    expect(h.effectiveTarget).toBe(3);
    expect(h.streak).toBe(0); // 2 < 3, not met
  });

  it('walks back weeks while met, and a met current week is included', () => {
    const cats = [cat(1)];
    const goals = [goal({ category_id: 1, kind: 'weekly_frequency', target: 2 })];
    const blocks = [
      // current week (Mon 22, Tue 23) met
      dayBlock(1, 2026, 6, 22),
      dayBlock(1, 2026, 6, 23),
      // prior week Mon 15 + Tue 16 met
      dayBlock(1, 2026, 6, 15),
      dayBlock(1, 2026, 6, 16),
      // week before that (Mon 8) only 1 → unmet, stops the walk
      dayBlock(1, 2026, 6, 8),
    ];
    const [h] = computeHabits(blocks, cats, goals, [], NOW);
    expect(h.streak).toBe(2); // current + one prior
  });

  it('scores a past week against the revision that covered it', () => {
    const cats = [cat(1)];
    // Old revision target 3 covering [1970, 2026-06-22); new revision
    // target 1 active from 2026-06-22.
    const goals = [
      goal({
        category_id: 1,
        kind: 'weekly_frequency',
        target: 3,
        effective_from: '1970-01-01',
        retired_from: '2026-06-22',
      }),
      goal({
        category_id: 1,
        kind: 'weekly_frequency',
        target: 1,
        effective_from: '2026-06-22',
      }),
    ];
    const blocks = [
      // current week: 1 done, target 1 → met
      dayBlock(1, 2026, 6, 22),
      // last week (Mon 15): only 2 done, old target 3 → NOT met
      dayBlock(1, 2026, 6, 15),
      dayBlock(1, 2026, 6, 16),
    ];
    const [h] = computeHabits(blocks, cats, goals, [], NOW);
    // Current week counts (streak 1); last week scored against target 3 is
    // unmet, so the walk stops.
    expect(h.streak).toBe(1);
  });

  it('stops the walk at a week with no covering revision', () => {
    const cats = [cat(1)];
    // Revision only active from 2026-06-22 — last week (Mon 15) has no
    // covering revision.
    const goals = [
      goal({
        category_id: 1,
        kind: 'weekly_frequency',
        target: 1,
        effective_from: '2026-06-22',
      }),
    ];
    const blocks = [
      dayBlock(1, 2026, 6, 22), // current week met
      dayBlock(1, 2026, 6, 15), // last week done, but uncovered
    ];
    const [h] = computeHabits(blocks, cats, goals, [], NOW);
    expect(h.streak).toBe(1);
  });

  it('labels the row with the days/week target', () => {
    const cats = [cat(1)];
    const goals = [goal({ category_id: 1, kind: 'weekly_frequency', target: 5 })];
    const [h] = computeHabits([], cats, goals, [], NOW);
    expect(h.kind).toBe('weekly_frequency');
    expect(h.target).toBe(5);
  });
});

// --- Weekly minutes goals ---

describe('computeWeeklyGoals', () => {
  const NOW = new Date(2026, 5, 24, 20, 0); // Wed; Monday = 22

  it('only surfaces categories with an ACTIVE weekly_minutes goal', () => {
    const cats = [cat(1), cat(2), cat(3)];
    const goals = [
      // active weekly for cat 1
      goal({ category_id: 1, kind: 'weekly_minutes', target: 600 }),
      // retired weekly for cat 2 → excluded
      goal({
        category_id: 2,
        kind: 'weekly_minutes',
        target: 300,
        retired_from: '2026-06-01',
      }),
      // cat 3 has a habit, not a weekly goal → excluded here
      goal({ category_id: 3, kind: 'daily_habit', target: 1 }),
    ];
    const res = computeWeeklyGoals([], cats, goals, NOW);
    expect(res.map((r) => r.category.id)).toEqual([1]);
    expect(res[0].targetMinutes).toBe(600);
  });

  it('sums the current week and splits a midnight-crossing block by day', () => {
    const cats = [cat(1)];
    const goals = [goal({ category_id: 1, kind: 'weekly_minutes', target: 600 })];
    // Tue 23 23:30 → Wed 24 00:30 : 30 min on Tue, 30 min on Wed.
    const blocks = [block(1, new Date(2026, 5, 23, 23, 30), new Date(2026, 5, 24, 0, 30))];
    const [r] = computeWeeklyGoals(blocks, cats, goals, NOW);
    expect(r.doneMs).toBe(60 * 60000);
    expect(r.byDayMs[1]).toBe(30 * 60000); // Tuesday
    expect(r.byDayMs[2]).toBe(30 * 60000); // Wednesday
  });

  it('ignores plan blocks', () => {
    const cats = [cat(1)];
    const goals = [goal({ category_id: 1, kind: 'weekly_minutes', target: 600 })];
    const blocks = [
      block(1, new Date(2026, 5, 22, 9), new Date(2026, 5, 22, 11), 'plan'),
    ];
    const [r] = computeWeeklyGoals(blocks, cats, goals, NOW);
    expect(r.doneMs).toBe(0);
  });

  it('excludes archived categories even with an active goal', () => {
    const archived = { ...cat(1), archived: true };
    const goals = [goal({ category_id: 1, kind: 'weekly_minutes', target: 600 })];
    expect(computeWeeklyGoals([], [archived], goals, NOW)).toEqual([]);
  });
});
