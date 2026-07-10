import { describe, it, expect } from 'vitest';
import type { Category, PhoneInboxEntry } from '@shared/types';
import { resolveEntry, toCommitDrafts } from './phoneInbox';

function cat(id: number, name: string): Category {
  return {
    id,
    name,
    color: '#B0512F',
    archived: false,
    created_at: '2026-01-01T00:00:00.000Z',
  };
}

function entry(text: string, ts: string | null): PhoneInboxEntry {
  return { id: 'x', ts, text };
}

const categories = [cat(1, 'Deep work'), cat(2, 'Lunch')];

describe('resolveEntry', () => {
  it('honors an explicit time range logged after the fact', () => {
    // Logged at 4pm about a 2-3pm block — both times are in the past
    // relative to the capture time, so nothing is clamped.
    const [d] = resolveEntry(
      entry('deep work 2-3pm', '2026-06-22T16:00:00-07:00'),
      categories,
      [],
      30
    );
    expect(d.categoryId).toBe(1);
    const start = new Date(d.startAt);
    const end = new Date(d.endAt);
    expect(start.getHours()).toBe(14);
    expect(end.getHours()).toBe(15);
  });

  it('honors an explicit "from X - Y" range with minutes', () => {
    // Logged at 6pm about a 1:00-1:45pm run.
    const [d] = resolveEntry(
      entry('ran from 1pm - 1:45pm', '2026-06-22T18:00:00-07:00'),
      categories,
      [],
      30
    );
    const start = new Date(d.startAt);
    const end = new Date(d.endAt);
    expect(start.getHours()).toBe(13);
    expect(start.getMinutes()).toBe(0);
    expect(end.getHours()).toBe(13);
    expect(end.getMinutes()).toBe(45);
    // 45 minutes, NOT the 30-min default.
    expect(end.getTime() - start.getTime()).toBe(45 * 60_000);
  });

  it('honors a start time + explicit duration', () => {
    const [d] = resolveEntry(
      entry('standup at 10am for 15m', '2026-06-22T18:00:00-07:00'),
      categories,
      [],
      30
    );
    const start = new Date(d.startAt);
    const end = new Date(d.endAt);
    expect(start.getHours()).toBe(10);
    expect(end.getTime() - start.getTime()).toBe(15 * 60_000);
  });

  it('clamps a future end-time to the capture moment (no future actuals)', () => {
    // Logged at 9am saying "2-3pm" — a future range. The parser clamps the
    // end to now; resolveEntry then gives it the default duration so it's
    // still a valid block rather than being dropped.
    const [d] = resolveEntry(
      entry('deep work 2-3pm', '2026-06-22T09:00:00-07:00'),
      categories,
      [],
      30
    );
    expect(new Date(d.endAt).getTime()).toBeGreaterThan(
      new Date(d.startAt).getTime()
    );
  });

  it('synthesizes a default-duration block for a timeless entry', () => {
    const at = '2026-06-22T15:30:00-07:00';
    const [d] = resolveEntry(entry('deep work', at), categories, [], 30);
    expect(d.categoryId).toBe(1); // fuzzy-matched
    const start = new Date(d.startAt);
    const end = new Date(d.endAt);
    expect(start.toISOString()).toBe(new Date(at).toISOString());
    expect(end.getTime() - start.getTime()).toBe(30 * 60_000);
    expect(d.note).toBe('deep work');
  });

  it('leaves an unmatched timeless entry uncategorized (→ inbox)', () => {
    const [d] = resolveEntry(
      entry('xyzzy nonsense', '2026-06-22T15:30:00-07:00'),
      categories,
      [],
      30
    );
    expect(d.categoryId).toBeNull();
  });

  it('falls back to now when the timestamp is missing/garbage', () => {
    const before = Date.now();
    const [d] = resolveEntry(entry('deep work', null), categories, [], 15);
    const start = new Date(d.startAt).getTime();
    expect(start).toBeGreaterThanOrEqual(before - 1000);
    expect(new Date(d.endAt).getTime() - start).toBe(15 * 60_000);
  });

  it('always produces at least one committable block', () => {
    const drafts = resolveEntry(
      entry('', '2026-06-22T15:30:00-07:00'),
      categories,
      [],
      30
    );
    // Empty text still yields a (note-less) block rather than dropping it.
    expect(drafts.length).toBeGreaterThanOrEqual(1);
    for (const d of drafts) {
      expect(new Date(d.endAt).getTime()).toBeGreaterThan(
        new Date(d.startAt).getTime()
      );
    }
  });
});

describe('toCommitDrafts', () => {
  it('routes null categories to the inbox id and never teaches', () => {
    const resolved = resolveEntry(
      entry('xyzzy nonsense', '2026-06-22T15:30:00-07:00'),
      categories,
      [],
      30
    );
    const [c] = toCommitDrafts(resolved, 99);
    expect(c.categoryId).toBe(99);
    expect(c.newCategory).toBeNull();
    expect(c.teach).toBe(false);
    expect(c.kind).toBe('actual');
  });

  it('keeps a matched category id', () => {
    const resolved = resolveEntry(
      entry('lunch', '2026-06-22T12:00:00-07:00'),
      categories,
      [],
      30
    );
    const [c] = toCommitDrafts(resolved, 99);
    expect(c.categoryId).toBe(2);
  });
});
