import { parseTimeInput } from '../time';

// Parse a single clock token (e.g. "9", "9:30am", "noon", "1130") to one
// or more candidate Dates on `day`. A bare hour is genuinely ambiguous
// (9 could be 9am or 9pm), so it yields TWO candidates; the range
// resolver in parse.ts then picks the pair with the shortest span.

// For a lone token (start-only / end-only) with no second endpoint to
// compare against, this constant picks the default: bare hours 1–6 read
// as afternoon, 7–11 as morning, 12 as noon.
const EVENING_PM_CUTOFF = 7;

export interface ClockToken {
  date: Date;
  ambiguous: boolean;
}

// A candidate interpretation of a clock token. A bare hour produces two
// (am + pm); an explicit time or keyword produces one. `preferred` marks
// the reading the daytime heuristic favors — used only as a tie-breaker
// when two interpretations of a range have the same duration.
export interface ClockCandidate {
  date: Date;
  preferred: boolean;
}

function at(day: Date, h: number, m: number): Date {
  const d = new Date(day);
  d.setHours(h, m, 0, 0);
  return d;
}

// Does this token pin down am/pm by itself — meridiem, a leading zero, or
// a 24h value (13..23 / 4-digit military)? If so it has one fixed reading.
// A bare colon time ("2:55", "9:30") is NOT fixed: the colon only sets the
// minutes, so it stays am/pm-flexible and the range resolver decides.
function isExplicit(token: string): boolean {
  const s = token.trim().toLowerCase().replace(/\s+/g, '');
  if (/[ap]\.?m?\.?$/.test(s)) return true; // 9am, 9pm, 9a, 9p, 2:55pm
  if (/^0\d/.test(s)) return true; // 07, 09:30 → zero-padded, explicit 24h
  const n = parseInt(s, 10);
  if (!Number.isNaN(n) && n >= 13) return true; // 13..23, or 0930/1130 military, 14:30
  return false;
}

// Which reading does the daytime heuristic prefer for a bare hour 1..12?
// 1–6 → afternoon, 7–11 → morning, 12 → noon (the 12:00 candidate).
function prefersAm(h: number): boolean {
  if (h === 12) return false;
  return h >= EVENING_PM_CUTOFF;
}

function flexible(day: Date, h: number, m: number): ClockCandidate[] {
  const amHour = h === 12 ? 0 : h % 12;
  const pmHour = h === 12 ? 12 : (h % 12) + 12;
  const am = prefersAm(h);
  return [
    { date: at(day, amHour, m), preferred: am },
    { date: at(day, pmHour, m), preferred: !am },
  ];
}

export function clockCandidates(
  rawToken: string,
  day: Date,
  now: Date
): ClockCandidate[] | null {
  const token = rawToken.trim().toLowerCase();
  if (!token) return null;

  if (token === 'noon') return [{ date: at(day, 12, 0), preferred: true }];
  if (token === 'midnight') return [{ date: at(day, 0, 0), preferred: true }];
  if (token === 'now')
    return [{ date: at(day, now.getHours(), now.getMinutes()), preferred: true }];

  // "9.30" means 9:30 (ambiguous am/pm); "13.5" (one fractional digit) and
  // "9.75" (≥60) fall through to parseTimeInput's decimal-hours reading.
  const dec = token.match(/^(\d{1,2})\.(\d{2})$/);
  if (dec) {
    const hh = parseInt(dec[1], 10);
    const mm = parseInt(dec[2], 10);
    if (mm < 60) {
      if (hh >= 1 && hh <= 12) return flexible(day, hh, mm);
      if (hh <= 23) return [{ date: at(day, hh, mm), preferred: true }];
    }
  }

  const base = parseTimeInput(token, day);
  if (!base) return null;

  if (isExplicit(token)) return [{ date: base, preferred: true }];

  const h = base.getHours();
  if (h >= 1 && h <= 12) return flexible(day, h, base.getMinutes());
  return [{ date: base, preferred: true }]; // bare "0" etc. → single fixed
}

// Resolve a single token to its preferred reading (start-only / end-only,
// where there's no second endpoint to minimize a span against).
export function parseClock(
  rawToken: string,
  day: Date,
  now: Date
): ClockToken | null {
  const cands = clockCandidates(rawToken, day, now);
  if (!cands) return null;
  const pref = cands.find((c) => c.preferred) ?? cands[0];
  return { date: pref.date, ambiguous: cands.length > 1 };
}
