import type {
  AliasEntry,
  Block,
  Category,
  CommitDraft,
  PhoneInboxEntry,
} from '@shared/types';
import { parseDay } from './capture/parse';
import { matchCategory } from './capture/match';
import { startOfLocalDay } from './time';

// Turn a phone-logged entry into committable drafts, reusing the SAME
// natural-language parser the manual capture modal uses.
//
// Strategy:
//  - Parse with `now` = the entry's own capture time. Entries with
//    explicit times ("lunch 12-1") resolve exactly as in the modal.
//  - A timeless entry ("deep work") yields no parser draft, so we
//    synthesize one: start = when it was logged, end = start +
//    defaultMinutes.
//  - A draft the parser left short (no end, or end <= start) is coerced
//    the same way — so EVERY entry produces at least one block and nothing
//    logged from the phone is ever silently dropped.
//  - categoryId === null means "no match" → the caller routes it to the
//    Phone-log inbox category. We never auto-create categories from
//    arbitrary phone text.

export interface ResolvedDraft {
  startAt: string;
  endAt: string;
  categoryId: number | null; // null → route to inbox category
  note: string | null;
  rawPhrase: string;
}

const MIN_MS = 60_000;

export function resolveEntry(
  entry: PhoneInboxEntry,
  categories: Category[],
  aliases: AliasEntry[],
  defaultMinutes: number,
  // Blocks already known for the entry's day (committed, plus any synthesized
  // earlier in the same drain). The parser needs these so a phone log can say
  // "from last event till now …" without sight of the timeline. Overlap
  // warnings are still ignored on this auto-commit path.
  existingBlocks: Block[] = []
): ResolvedDraft[] {
  const parsedTs = entry.ts ? new Date(entry.ts) : null;
  const at =
    parsedTs && !Number.isNaN(parsedTs.getTime()) ? parsedTs : new Date();
  const defaultMs = Math.max(1, defaultMinutes) * MIN_MS;

  const { drafts } = parseDay({
    text: entry.text,
    targetDay: startOfLocalDay(at),
    now: at,
    categories,
    existingBlocks,
    aliases,
  });

  if (drafts.length === 0) {
    // Timeless entry — synthesize a default-duration block at log time.
    const match = matchCategory(entry.text, categories, aliases);
    const end = new Date(at.getTime() + defaultMs);
    return [
      {
        startAt: at.toISOString(),
        endAt: end.toISOString(),
        categoryId: match.categoryId,
        note: entry.text.trim() || null,
        rawPhrase: '',
      },
    ];
  }

  return drafts.map((d) => {
    const start = d.startAt ? new Date(d.startAt) : at;
    let end = d.endAt ? new Date(d.endAt) : new Date(start.getTime() + defaultMs);
    if (end.getTime() <= start.getTime()) {
      end = new Date(start.getTime() + defaultMs);
    }
    return {
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      categoryId: d.categoryId,
      note: d.note,
      rawPhrase: d.rawPhrase,
    };
  });
}

// Final mapping to the commit payload, once the inbox category id is known.
// Unmatched drafts (categoryId null) fall back to the inbox category.
export function toCommitDrafts(
  resolved: ResolvedDraft[],
  inboxCategoryId: number
): CommitDraft[] {
  return resolved.map((r) => ({
    startAt: r.startAt,
    endAt: r.endAt,
    categoryId: r.categoryId ?? inboxCategoryId,
    newCategory: null,
    note: r.note,
    kind: 'actual',
    rawPhrase: r.rawPhrase,
    teach: false, // never auto-learn aliases from unattended phone entries
  }));
}
