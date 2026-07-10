import { describe, it, expect } from 'vitest';
import type { AliasEntry, Block, Category } from '@shared/types';
import { parseDay } from './parse';

function cat(id: number, name: string): Category {
  return {
    id,
    name,
    color: '#B0512F',
    archived: false,
    created_at: '2020-01-01T00:00:00.000Z',
  };
}

const CATS: Category[] = [
  cat(1, 'Deep work'),
  cat(2, 'Interviews'),
  cat(3, 'Emails'),
  cat(4, 'Macey work'),
];

// A Monday far in the past, and a "now" late enough that nothing clamps.
const DAY = new Date(2020, 0, 6, 0, 0, 0);
const LATE = new Date(2020, 0, 6, 23, 59, 0);

function run(
  text: string,
  opts: {
    now?: Date;
    day?: Date;
    categories?: Category[];
    existingBlocks?: Block[];
    aliases?: AliasEntry[];
  } = {}
) {
  return parseDay({
    text,
    targetDay: opts.day ?? DAY,
    now: opts.now ?? LATE,
    categories: opts.categories ?? CATS,
    existingBlocks: opts.existingBlocks ?? [],
    aliases: opts.aliases ?? [],
  });
}

const h = (iso: string | null) => (iso ? new Date(iso).getHours() : null);
const m = (iso: string | null) => (iso ? new Date(iso).getMinutes() : null);

describe('parseDay — time ranges', () => {
  it('parses a simple morning range', () => {
    const { drafts } = run('9-11 deep work');
    expect(drafts).toHaveLength(1);
    expect(h(drafts[0].startAt)).toBe(9);
    expect(h(drafts[0].endAt)).toBe(11);
    expect(drafts[0].categoryId).toBe(1);
  });

  it('reads bare afternoon hours as the shortest span', () => {
    const { drafts } = run('1-4 meetings');
    expect(h(drafts[0].startAt)).toBe(13);
    expect(h(drafts[0].endAt)).toBe(16);
    // "meetings" matches nothing → left unassigned (no auto-category).
    expect(drafts[0].categoryId).toBeNull();
    expect(drafts[0].newCategoryName).toBeNull();
    expect(drafts[0].note).toBe('meetings');
  });

  it('picks the shortest same-day span across noon (11-1)', () => {
    const { drafts } = run('11-1 lunch');
    expect(h(drafts[0].startAt)).toBe(11);
    expect(h(drafts[0].endAt)).toBe(13);
  });

  it('handles a full workday with a bare PM end (8-5)', () => {
    const { drafts } = run('8-5 work');
    expect(h(drafts[0].startAt)).toBe(8);
    expect(h(drafts[0].endAt)).toBe(17);
  });

  it('respects explicit 24h times without the heuristic', () => {
    const { drafts } = run('21:00-22:30 reading');
    expect(h(drafts[0].startAt)).toBe(21);
    expect(h(drafts[0].endAt)).toBe(22);
    expect(m(drafts[0].endAt)).toBe(30);
  });

  it('handles noon/keywords in a range', () => {
    const { drafts } = run('noon-1 lunch');
    expect(h(drafts[0].startAt)).toBe(12);
    expect(h(drafts[0].endAt)).toBe(13);
  });
});

describe('parseDay — chaining & duration', () => {
  it('anchors an end-only segment to the previous end', () => {
    const { drafts } = run('9-11 deep work, coffee till 11:30');
    expect(drafts).toHaveLength(2);
    expect(h(drafts[1].startAt)).toBe(11);
    expect(h(drafts[1].endAt)).toBe(11);
    expect(m(drafts[1].endAt)).toBe(30);
  });

  it('forward-fills an unknown end from the next explicit start', () => {
    const { drafts } = run('1pm meetings, 4pm gym');
    expect(h(drafts[0].startAt)).toBe(13);
    expect(h(drafts[0].endAt)).toBe(16); // filled from gym's 4pm
    expect(h(drafts[1].startAt)).toBe(16);
    expect(drafts[1].endAt).toBeNull();
    expect(drafts[1].warnings).toContain('no-end');
  });

  it('chains a duration onto the cursor', () => {
    const { drafts } = run('9-9:30 emails, 30m standup');
    expect(drafts).toHaveLength(2);
    expect(h(drafts[1].startAt)).toBe(9);
    expect(m(drafts[1].startAt)).toBe(30);
    expect(h(drafts[1].endAt)).toBe(10);
    expect(m(drafts[1].endAt)).toBe(0);
  });

  it('fills a timeless mid-chain item between two timed ones', () => {
    const { drafts } = run('12-1 lunch break, gym, 2-3 emails');
    // "gym" is timeless: start = lunch end (13:00), end = next start (14:00)
    const gym = drafts.find((d) => /gym/i.test(d.rawText));
    expect(gym).toBeTruthy();
    expect(h(gym!.startAt)).toBe(13);
    expect(h(gym!.endAt)).toBe(14);
  });
});

describe('parseDay — segmentation & leftovers', () => {
  it('produces one draft per line', () => {
    const { drafts } = run('9-10 deep work\n10-11 emails');
    expect(drafts).toHaveLength(2);
  });

  it('treats an unanchored timeless segment as a leftover', () => {
    const { drafts, leftovers } = run('blah');
    expect(drafts).toHaveLength(0);
    expect(leftovers).toContain('blah');
  });
});

describe('parseDay — clamping', () => {
  it('clamps an end past now back to now on today', () => {
    const noon = new Date(2020, 0, 6, 12, 0, 0);
    const { drafts } = run('9-3pm work', { now: noon });
    expect(h(drafts[0].endAt)).toBe(12);
    expect(m(drafts[0].endAt)).toBe(0);
    expect(drafts[0].warnings).toContain('clamped-to-now');
  });

  it('does not clamp when the target day is not today', () => {
    // Logging a PAST day: target 2020-01-07, but "now" is two days later,
    // so the block is fully in the past and nothing clamps.
    const pastDay = new Date(2020, 0, 7, 0, 0, 0);
    const { drafts } = run('9-11 deep work', {
      day: pastDay,
      now: new Date(2020, 0, 9, 8, 0, 0),
    });
    expect(h(drafts[0].endAt)).toBe(11);
    expect(drafts[0].warnings).not.toContain('clamped-to-now');
  });
});

describe('parseDay — matching & aliases', () => {
  it('fuzzy-matches a phrase containing a category name', () => {
    const { drafts } = run('9-11 macey pricing deck');
    expect(drafts[0].categoryId).toBe(4); // Macey work
    expect(drafts[0].note).toBe('macey pricing deck');
  });

  it('drops the note when the phrase is just the category name', () => {
    const { drafts } = run('9-11 emails');
    expect(drafts[0].categoryId).toBe(3);
    expect(drafts[0].note).toBeNull();
  });

  it('prefers a learned alias over fuzzy matching', () => {
    const aliases: AliasEntry[] = [{ phrase: 'standup', categoryId: 2 }];
    const { drafts } = run('standup at 10', { aliases });
    expect(drafts[0].categoryId).toBe(2);
    expect(drafts[0].viaAlias).toBe(true);
    expect(h(drafts[0].startAt)).toBe(10);
  });

  it('ignores aliases whose category no longer exists', () => {
    const aliases: AliasEntry[] = [{ phrase: 'standup', categoryId: 999 }];
    const { drafts } = run('9-10 standup', { aliases });
    expect(drafts[0].categoryId).toBeNull();
    expect(drafts[0].newCategoryName).toBeNull();
    expect(drafts[0].note).toBe('standup');
  });
});

describe('parseDay — shortest-span am/pm resolution', () => {
  const cases: [string, number, number][] = [
    ['11-2pm sync', 11, 14],
    ['11-2 sync', 11, 14],
    ['2-5 work', 14, 17],
    ['8-11 work', 8, 11],
    ['9-5 work', 9, 17],
    ['12-3 work', 12, 15],
    ['10-12 work', 10, 12],
  ];
  for (const [text, startH, endH] of cases) {
    it(`reads "${text}" as ${startH}:00–${endH}:00`, () => {
      const { drafts } = run(text);
      expect(h(drafts[0].startAt)).toBe(startH);
      expect(h(drafts[0].endAt)).toBe(endH);
    });
  }

  // A bare colon time ("2:55") only fixes minutes, not am/pm — it must
  // still flex so the shortest span wins.
  it('resolves a bare colon start to the shortest span (2:55-3pm)', () => {
    const { drafts } = run('2:55-3pm meeting');
    expect(h(drafts[0].startAt)).toBe(14);
    expect(m(drafts[0].startAt)).toBe(55);
    expect(h(drafts[0].endAt)).toBe(15);
    expect(m(drafts[0].endAt)).toBe(0);
  });

  it('keeps a colon start in the morning when that is shortest (9:30-11)', () => {
    const { drafts } = run('9:30-11 standup');
    expect(h(drafts[0].startAt)).toBe(9);
    expect(m(drafts[0].startAt)).toBe(30);
    expect(h(drafts[0].endAt)).toBe(11);
  });
});

describe('parseDay — unassigned categories (no auto-create)', () => {
  it('leaves an unmatched phrase unassigned with the phrase as the note', () => {
    const { drafts } = run('9-10 lunch');
    expect(drafts[0].categoryId).toBeNull();
    expect(drafts[0].newCategoryName).toBeNull();
    expect(drafts[0].note).toBe('lunch');
  });
});

describe('parseDay — sequence filler', () => {
  it('splits on "then" and "after that" without leaking them into notes', () => {
    const { drafts } = run('9-10 standup then 10-11 review, after that 1-2 sync');
    expect(drafts).toHaveLength(3);
    expect(drafts[1].note).toBe('review');
    expect(drafts[2].note).toBe('sync');
  });

  it('strips a leading filler word from a description', () => {
    const { drafts } = run('9-10 emails, next planning');
    const planning = drafts.find((d) => /planning/.test(d.rawText));
    expect(planning?.note).toBe('planning');
  });
});

describe('parseDay — regression: phantom meridiem (range followed by a/p word)', () => {
  it('does not read the activity word as am/pm (9-11 pricing)', () => {
    const { drafts } = run('9-11 pricing');
    expect(h(drafts[0].startAt)).toBe(9);
    expect(h(drafts[0].endAt)).toBe(11);
    expect(drafts[0].warnings).not.toContain('end-before-start');
  });

  it('handles a midday range before an a-word (10-12 analysis)', () => {
    const { drafts } = run('10-12 analysis');
    expect(h(drafts[0].startAt)).toBe(10);
    expect(h(drafts[0].endAt)).toBe(12);
  });

  it('still applies the PM heuristic before a p-word (1-3 planning)', () => {
    const { drafts } = run('1-3 planning');
    expect(h(drafts[0].startAt)).toBe(13);
    expect(h(drafts[0].endAt)).toBe(15);
  });
});

describe('parseDay — regression: start + duration in one segment', () => {
  it('combines an explicit start with a duration (at 10 for 30m standup)', () => {
    const { drafts } = run('at 10 for 30m standup');
    expect(drafts).toHaveLength(1);
    expect(h(drafts[0].startAt)).toBe(10);
    expect(h(drafts[0].endAt)).toBe(10);
    expect(m(drafts[0].endAt)).toBe(30);
  });

  it('combines a leading start with a duration (9 deep work for 2h)', () => {
    const { drafts } = run('9 deep work for 2h');
    expect(h(drafts[0].startAt)).toBe(9);
    expect(h(drafts[0].endAt)).toBe(11);
    expect(drafts[0].categoryId).toBe(1);
  });

  it('treats a leading number that IS the duration as a duration (15 min standup)', () => {
    const { drafts } = run('8-9 emails, 15 min standup');
    expect(h(drafts[1].startAt)).toBe(9); // chained from the cursor, not 15:00
    expect(h(drafts[1].endAt)).toBe(9);
    expect(m(drafts[1].endAt)).toBe(15);
  });
});

describe('parseDay — regression: decimal H.MM clock notation', () => {
  it('reads 9.30 as 9:30, not 9:18', () => {
    const { drafts } = run('9.30-10:30 sync');
    expect(h(drafts[0].startAt)).toBe(9);
    expect(m(drafts[0].startAt)).toBe(30);
  });

  it('still reads 13.5 as decimal hours (13:30)', () => {
    const { drafts } = run('13.5 deep work');
    expect(h(drafts[0].startAt)).toBe(13);
    expect(m(drafts[0].startAt)).toBe(30);
  });
});

describe('parseDay — regression: short fragments do not over-match', () => {
  it('does not bind a 1-char phrase to a category by substring', () => {
    const { drafts } = run('9-10 e');
    expect(drafts[0].categoryId).toBeNull();
  });
});

describe('parseDay — overlap warning', () => {
  it('warns when a draft overlaps an existing actual block', () => {
    const existing: Block[] = [
      {
        id: 1,
        category_id: 1,
        start_at: new Date(2020, 0, 6, 9, 30, 0).toISOString(),
        end_at: new Date(2020, 0, 6, 10, 30, 0).toISOString(),
        note: null,
        kind: 'actual',
        external_source: null,
        external_id: null,
        detached: false,
        pomodoro: null,
        created_at: '2020-01-06T00:00:00.000Z',
        updated_at: '2020-01-06T00:00:00.000Z',
      },
    ];
    const { drafts } = run('9-11 deep work', { existingBlocks: existing });
    expect(drafts[0].warnings).toContain('overlaps-existing');
  });
});

describe('parseDay — "from last event" anchor', () => {
  // Build an actual (or plan) block on DAY spanning [startH, endH).
  function evt(id: number, startH: number, endH: number, kind = 'actual') {
    return {
      id,
      category_id: 1,
      start_at: new Date(2020, 0, 6, startH, 0, 0).toISOString(),
      end_at: new Date(2020, 0, 6, endH, 0, 0).toISOString(),
      note: null,
      kind,
      external_source: null,
      external_id: null,
      detached: false,
      pomodoro: null,
      created_at: '2020-01-06T00:00:00.000Z',
      updated_at: '2020-01-06T00:00:00.000Z',
    } as Block;
  }

  const NOW = new Date(2020, 0, 6, 15, 30, 0);

  it('anchors "from last event till now X" to the last actual end', () => {
    const { drafts } = run('from last event till now Ammamma Walk', {
      now: NOW,
      existingBlocks: [evt(1, 13, 14)],
    });
    expect(drafts).toHaveLength(1);
    expect(h(drafts[0].startAt)).toBe(14);
    expect(h(drafts[0].endAt)).toBe(15);
    expect(m(drafts[0].endAt)).toBe(30);
    expect(drafts[0].note).toBe('Ammamma Walk');
    expect(drafts[0].warnings).not.toContain('no-start');
  });

  it('picks the latest actual end among several blocks', () => {
    const { drafts } = run('from last event till now walk', {
      now: NOW,
      existingBlocks: [evt(1, 9, 11), evt(2, 13, 14), evt(3, 11, 12)],
    });
    expect(h(drafts[0].startAt)).toBe(14);
  });

  it('ignores plan blocks — only actual events count', () => {
    const { drafts } = run('from last event till now walk', {
      now: NOW,
      // A later-ending plan block must not win over the actual one.
      existingBlocks: [evt(1, 13, 14, 'actual'), evt(2, 14, 16, 'plan')],
    });
    expect(h(drafts[0].startAt)).toBe(14);
  });

  it('supports an explicit duration ("for 30m")', () => {
    const { drafts } = run('from last event for 30m walk', {
      now: NOW,
      existingBlocks: [evt(1, 13, 14)],
    });
    expect(h(drafts[0].startAt)).toBe(14);
    expect(h(drafts[0].endAt)).toBe(14);
    expect(m(drafts[0].endAt)).toBe(30);
    expect(drafts[0].note).toBe('walk');
  });

  it('with no end, anchors the start and leaves the end open', () => {
    const { drafts } = run('from last event walk', {
      now: NOW,
      existingBlocks: [evt(1, 13, 14)],
    });
    expect(h(drafts[0].startAt)).toBe(14);
    expect(drafts[0].endAt).toBeNull();
    expect(drafts[0].warnings).toContain('no-end');
  });

  it('accepts the "since"/"previous" phrasings', () => {
    const { drafts } = run('since previous event till now walk', {
      now: NOW,
      existingBlocks: [evt(1, 13, 14)],
    });
    expect(h(drafts[0].startAt)).toBe(14);
    expect(h(drafts[0].endAt)).toBe(15);
  });

  it('does not hijack a mid-note mention of "last task"', () => {
    // The anchor only leads a segment; here "last task" is plain activity.
    const { drafts } = run('9-10 review last task', {
      now: NOW,
      existingBlocks: [evt(1, 13, 14)],
    });
    expect(h(drafts[0].startAt)).toBe(9);
    expect(h(drafts[0].endAt)).toBe(10);
    expect(drafts[0].note).toBe('review last task');
  });

  it('flags no-start when there is no prior event to anchor to', () => {
    const { drafts } = run('from last event till now walk', {
      now: NOW,
      existingBlocks: [],
    });
    expect(drafts[0].startAt).toBeNull();
    expect(drafts[0].warnings).toContain('no-start');
    // The "till now" end is still resolved.
    expect(h(drafts[0].endAt)).toBe(15);
    expect(drafts[0].note).toBe('walk');
  });
});
