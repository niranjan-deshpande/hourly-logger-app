import type {
  AliasEntry,
  Block,
  CaptureDraft,
  CaptureResult,
  CaptureWarning,
  Category,
} from '@shared/types';
import { fromIso, sameDay } from '../time';
import { segmentText } from './segment';
import { clockCandidates, parseClock, type ClockCandidate } from './clock';
import { matchCategory, normalize } from './match';

export interface ParseInput {
  text: string;
  targetDay: Date;
  now: Date;
  categories: Category[];
  existingBlocks: Block[];
  aliases?: AliasEntry[];
}

// A single clock token, in the alternation order that matters: keywords,
// then decimal (13.5), HH:MM(+meridiem), H+meridiem (9pm), 4-digit
// military (0930), and finally a bare 1–2 digit hour as the fallback.
//
// The `(?![a-z])` after each meridiem is load-bearing: without it, a range
// followed by an activity word starting with a/p — "9-11 pricing" — would
// let the second token greedily eat the " p" as "pm" and read 23:00. The
// negative lookahead forces a real meridiem (followed by a non-letter),
// and the regex backtracks the `\s*` so "9:30 emails" still matches "9:30".
const T = String.raw`(?:noon|midnight|now|\d{1,2}\.\d{1,2}|\d{1,2}:\d{2}\s*(?:[ap]\.?m?\.?)?(?![a-z])|\d{1,2}\s*[ap]\.?m?\.?(?![a-z])|\d{3,4}|\d{1,2})`;

const RANGE = new RegExp(String.raw`(${T})\s*(?:[-–—]|\bto\b)\s*(${T})`, 'i');
const ENDONLY = new RegExp(String.raw`\b(?:till|until|til)\s+(${T})`, 'i');
const START_PREFIX = new RegExp(String.raw`(?:\bfrom\b|\bat\b|@)\s*(${T})\b`, 'i');
const START_LEAD = new RegExp(String.raw`^\s*(${T})\b`, 'i');

// "(from|since|after) last event" — a symbolic START anchor that resolves to
// the end of the most recent actual block (see lastEventEnd). It lets a phone
// log written without sight of the timeline say "from last event till now
// Ammamma Walk". Anchored to the START of the segment (like START_LEAD) and
// with a narrow noun set (event/block/entry/activity/task) so a mid-note
// mention — "review last task" — isn't mistaken for an anchor.
const LAST_EVENT = new RegExp(
  String.raw`^\s*(?:(?:from|since|after)\s+)?(?:the\s+|my\s+)?(?:last|previous|prev)\s+(?:event|block|entry|activity|task)\b`,
  'i'
);
// The optional end that may follow the anchor: "till now", "until 5",
// "to 6pm", "- 6pm". Reuses the shared clock-token pattern T.
const LAST_EVENT_END = new RegExp(
  String.raw`(?:\b(?:till|until|til|to)\b|[-–—])\s*(${T})`,
  'i'
);

interface Extracted {
  start: Date | null;
  end: Date | null;
  durationMin: number | null;
  activity: string;
}

export function parseDay(input: ParseInput): CaptureResult {
  const {
    text,
    targetDay,
    now,
    categories,
    existingBlocks,
    aliases = [],
  } = input;

  const segments = segmentText(text);
  const leftovers: string[] = [];

  // Phase 1 — per-segment time extraction. A segment with neither a time
  // nor any activity text is noise: straight to leftovers.
  // Resolve the "last event" anchor once for the whole capture: the end of
  // the most recent actual block at or before `now`. Null when there's none.
  const lastEnd = lastEventEnd(existingBlocks, now);

  const segObjs: ({ rawText: string } & Extracted | null)[] = segments.map(
    (seg) => {
      const ex = extractTime(seg, targetDay, now, lastEnd);
      if (
        ex.start == null &&
        ex.end == null &&
        ex.durationMin == null &&
        !ex.activity
      ) {
        leftovers.push(seg);
        return null;
      }
      return { rawText: seg, ...ex };
    }
  );

  // Phase 2 — chain segments, threading a cursor (last resolved end), and
  // forward-fill an unknown end from the next explicitly-timed segment.
  interface Resolved {
    rawText: string;
    activity: string;
    start: Date | null;
    end: Date | null;
  }
  const resolved: Resolved[] = [];
  let cursor: Date | null = null;
  for (let i = 0; i < segObjs.length; i++) {
    const r = segObjs[i];
    if (!r) continue;
    let start = r.start;
    let end = r.end;

    if (start == null && end != null) {
      start = cursor; // end-only ("till 12"): anchor to previous end
    } else if (start != null && end == null && r.durationMin != null) {
      end = addMinutes(start, r.durationMin);
    } else if (start == null && end == null && r.durationMin != null) {
      start = cursor;
      if (start) end = addMinutes(start, r.durationMin);
    } else if (start == null && end == null) {
      start = cursor; // neither: chain start; end forward-filled below
    }

    if (start != null && end == null) {
      const nf = nextExplicitStart(segObjs, i);
      if (nf && nf > start) end = nf;
    }

    resolved.push({ rawText: r.rawText, activity: r.activity, start, end });
    if (end) cursor = end;
    else if (start) cursor = start;
  }

  // Phase 3 — build drafts. A segment that ended the chain with no time at
  // all (couldn't be anchored) is demoted to a leftover.
  const isToday = sameDay(targetDay, now);
  const drafts: CaptureDraft[] = [];
  for (const r of resolved) {
    if (r.start == null && r.end == null) {
      leftovers.push(r.rawText);
      continue;
    }

    const match = matchCategory(r.activity, categories, aliases);
    const cat =
      match.categoryId != null
        ? categories.find((c) => c.id === match.categoryId)
        : undefined;

    let start = r.start;
    let end = r.end;
    const warnings: CaptureWarning[] = [];

    if (isToday && start && start > now) warnings.push('in-future');
    if (isToday && end && end > now) {
      end = new Date(now);
      warnings.push('clamped-to-now');
    }
    if (start == null) warnings.push('no-start');
    if (end == null) warnings.push('no-end');
    if (start && end && end <= start) warnings.push('end-before-start');
    if (
      start &&
      end &&
      end > start &&
      overlapsExisting(start, end, existingBlocks, 'actual')
    ) {
      warnings.push('overlaps-existing');
    }

    // Unmatched phrases are left UNASSIGNED — the review UI requires the
    // user to pick (or explicitly create) a category, which is then
    // remembered as an alias. We no longer invent a category from the
    // phrase. The phrase is kept as the note so the row still reads well.
    drafts.push({
      tempId: `cap-${drafts.length}`,
      startAt: start ? start.toISOString() : null,
      endAt: end ? end.toISOString() : null,
      categoryId: match.categoryId,
      newCategoryName: null,
      newCategoryColor: null,
      note: noteAgainst(r.activity, cat?.name),
      kind: 'actual',
      rawText: r.rawText,
      rawPhrase: normalize(r.activity),
      warnings,
      taught: false,
      viaAlias: match.viaAlias,
    });
  }

  return { drafts, leftovers };
}

function extractTime(
  seg: string,
  day: Date,
  now: Date,
  lastEnd: Date | null
): Extracted {
  // 0. "from last event …" — anchor the start to the end of the most recent
  // actual block. An optional end ("till now", "to 6pm", "for 90m") is read
  // from the remainder; otherwise the end is forward-filled like any other
  // start-only segment. With no prior event to anchor to we still strip the
  // phrase and leave the start unresolved (surfaced as a 'no-start' warning).
  const le = LAST_EVENT.exec(seg);
  if (le && le.index != null) {
    const remainder =
      seg.slice(0, le.index) + ' ' + seg.slice(le.index + le[0].length);
    let end: Date | null = null;
    let durationMin: number | null = null;
    let activity = remainder;

    const endM = LAST_EVENT_END.exec(remainder);
    if (endM && endM.index != null) {
      const e = parseClock(endM[1], day, now);
      if (e) {
        end = e.date;
        activity =
          remainder.slice(0, endM.index) +
          ' ' +
          remainder.slice(endM.index + endM[0].length);
      }
    }
    if (end == null) {
      const dur = parseDuration(remainder);
      if (dur) {
        durationMin = dur.minutes;
        activity =
          remainder.slice(0, dur.index) +
          ' ' +
          remainder.slice(dur.index + dur.length);
      }
    }

    if (lastEnd != null) {
      // Resolved anchor: combine with the explicit end or the duration now.
      const finalEnd =
        end ?? (durationMin != null ? addMinutes(lastEnd, durationMin) : null);
      return {
        start: lastEnd,
        end: finalEnd,
        durationMin: null,
        activity: cleanActivity(activity),
      };
    }
    // Unresolved anchor: keep any explicit end/duration so the segment can
    // still chain off the cursor, but leave the start null.
    return { start: null, end, durationMin, activity: cleanActivity(activity) };
  }

  // 1. explicit range ("9-11", "9 to noon"). The am/pm of each bare
  // endpoint is resolved by the shortest same-day span — see resolveRange.
  let m = RANGE.exec(seg);
  if (m && m.index != null) {
    const aCands = clockCandidates(m[1], day, now);
    const bCands = clockCandidates(m[2], day, now);
    if (aCands && bCands) {
      const activity = strip(seg, m.index, m[0].length);
      const r = resolveRange(aCands, bCands);
      if (r) {
        return { start: r.start, end: r.end, durationMin: null, activity };
      }
      // No forward same-day reading (e.g. two explicit times with
      // end <= start). Keep the preferred values; review flags it.
      const a = aCands.find((c) => c.preferred) ?? aCands[0];
      const b = bCands.find((c) => c.preferred) ?? bCands[0];
      return { start: a.date, end: b.date, durationMin: null, activity };
    }
  }

  // 2. end-only ("till 11:30")
  m = ENDONLY.exec(seg);
  if (m && m.index != null) {
    const e = parseClock(m[1], day, now);
    if (e) {
      return {
        start: null,
        end: e.date,
        durationMin: null,
        activity: strip(seg, m.index, m[0].length),
      };
    }
  }

  // 3. a single start (explicit prefix "at 10", else a leading time) and a
  // duration ("30m") are detected together so a segment carrying BOTH —
  // "at 10 for 30m standup", "9 deep work for 2h" — combines into
  // start+end instead of dropping the start.
  const startMatch = START_PREFIX.exec(seg) ?? START_LEAD.exec(seg);
  const startClock = startMatch ? parseClock(startMatch[1], day, now) : null;
  const dur = parseDuration(seg);

  // If the leading number IS the duration's number ("9 min" → 9 minutes,
  // not 9 o'clock), the spans overlap; treat it as a duration, not a start.
  const overlap =
    startMatch != null && dur != null
      ? startMatch.index < dur.index + dur.length &&
        dur.index < startMatch.index + startMatch[0].length
      : false;

  if (startClock && startMatch && dur && !overlap) {
    return {
      start: startClock.date,
      end: addMinutes(startClock.date, dur.minutes),
      durationMin: null,
      activity: stripSpans(seg, [
        { index: startMatch.index, length: startMatch[0].length },
        { index: dur.index, length: dur.length },
      ]),
    };
  }
  if (dur && (!startClock || overlap)) {
    return {
      start: null,
      end: null,
      durationMin: dur.minutes,
      activity: strip(seg, dur.index, dur.length),
    };
  }
  if (startClock && startMatch) {
    return {
      start: startClock.date,
      end: null,
      durationMin: null,
      activity: strip(seg, startMatch.index, startMatch[0].length),
    };
  }

  return { start: null, end: null, durationMin: null, activity: cleanActivity(seg) };
}

// Remove several spans from a string at once (used when a start and a
// duration both live in one segment). Spans are removed back-to-front so
// earlier indices stay valid.
function stripSpans(
  seg: string,
  spans: { index: number; length: number }[]
): string {
  const sorted = [...spans].sort((a, b) => b.index - a.index);
  let out = seg;
  for (const sp of sorted) {
    out = out.slice(0, sp.index) + ' ' + out.slice(sp.index + sp.length);
  }
  return cleanActivity(out);
}

// Pick the am/pm interpretation of a range with the SHORTEST same-day
// forward span — "11-2pm" → 11am–2pm (3h), never 11am–2am (15h). Ties
// break toward the daytime-preferred reading, then the earlier start.
function resolveRange(
  aCands: ClockCandidate[],
  bCands: ClockCandidate[]
): { start: Date; end: Date } | null {
  let best:
    | { start: Date; end: Date; dur: number; pref: number }
    | null = null;
  for (const a of aCands) {
    for (const b of bCands) {
      const dur = b.date.getTime() - a.date.getTime();
      if (dur <= 0) continue; // forward, same day only
      const pref = (a.preferred ? 1 : 0) + (b.preferred ? 1 : 0);
      const better =
        best == null ||
        dur < best.dur ||
        (dur === best.dur && pref > best.pref) ||
        (dur === best.dur &&
          pref === best.pref &&
          a.date.getTime() < best.start.getTime());
      if (better) best = { start: a.date, end: b.date, dur, pref };
    }
  }
  return best ? { start: best.start, end: best.end } : null;
}

function parseDuration(
  seg: string
): { minutes: number; index: number; length: number } | null {
  const re = /(\d{1,3})\s*(h|hr|hrs|hour|hours|m|min|mins|minute|minutes)\b/gi;
  let total = 0;
  let start = -1;
  let end = -1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(seg)) !== null) {
    const n = parseInt(m[1], 10);
    const isHours = m[2].toLowerCase()[0] === 'h';
    total += isHours ? n * 60 : n;
    if (start === -1) start = m.index;
    end = m.index + m[0].length;
  }
  if (total <= 0) return null;
  return { minutes: total, index: start, length: end - start };
}

function strip(seg: string, index: number, len: number): string {
  return cleanActivity(seg.slice(0, index) + ' ' + seg.slice(index + len));
}

// Tidy the leftover activity text: normalize dashes, collapse spaces, and
// drop a single dangling preposition at either edge (left by removing the
// time). Internal words are left untouched so notes keep their meaning.
function cleanActivity(s: string): string {
  let t = s.replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
  // Drop a leading dangling preposition (left by removing the time) or a
  // sequence-filler word ("then emails", "next lunch", "after that …").
  t = t.replace(
    /^(?:from|at|@|till|until|til|to|for|after that|and then|then|next|afterwards|and|-)\s+/i,
    ''
  );
  t = t.replace(/\s+(?:from|at|@|till|until|til|to|for|then|next|-)$/i, '');
  return t.trim();
}

// Suggest a category name from a phrase. No longer used during parsing
// (unmatched rows are left unassigned); the review UI calls it to pre-fill
// the name when the user opts to create a new category.
export function proposeCategoryName(activity: string): string {
  const cleaned = activity
    .replace(/^(?:worked on|working on|did|doing|do|on)\s+/i, '')
    .trim();
  const words = (cleaned || activity).split(/\s+/).filter(Boolean).slice(0, 4);
  const name = words.join(' ').slice(0, 24).trim();
  return titleCase(name) || 'New category';
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (ch) => ch.toUpperCase());
}

// The note for a draft is its activity phrase, unless that phrase is just
// the category's own name (no point repeating it).
function noteAgainst(activity: string, name: string | null | undefined): string | null {
  const a = activity.trim();
  if (!a) return null;
  if (name && normalize(a) === normalize(name)) return null;
  return a;
}

function overlapsExisting(
  start: Date,
  end: Date,
  blocks: Block[],
  kind: Block['kind']
): boolean {
  const s = start.getTime();
  const e = end.getTime();
  for (const b of blocks) {
    if (b.kind !== kind) continue;
    const bs = fromIso(b.start_at).getTime();
    const be = fromIso(b.end_at).getTime();
    if (bs < e && be > s) return true;
  }
  return false;
}

// The end time of the most recent actual block that has already ended (at or
// before `now`) — the anchor for a "from last event …" capture. Plan blocks
// are intentions, not events, so they're skipped. Null when there's nothing
// to anchor to.
function lastEventEnd(blocks: Block[], now: Date): Date | null {
  const nowMs = now.getTime();
  let best: number | null = null;
  for (const b of blocks) {
    if (b.kind !== 'actual') continue;
    const e = fromIso(b.end_at).getTime();
    if (e <= nowMs && (best == null || e > best)) best = e;
  }
  return best == null ? null : new Date(best);
}

function nextExplicitStart(
  segObjs: ({ rawText: string } & Extracted | null)[],
  i: number
): Date | null {
  for (let j = i + 1; j < segObjs.length; j++) {
    const r = segObjs[j];
    if (r && r.start) return r.start;
  }
  return null;
}

function addMinutes(d: Date, minutes: number): Date {
  return new Date(d.getTime() + minutes * 60000);
}
