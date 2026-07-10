// Time parsing + formatting helpers. All "date" values here are concrete Date objects
// in local time; storage uses ISO 8601 UTC strings.

export function formatTime(d: Date): string {
  return d
    .toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    .replace(/\s+/g, ' ')
    .trim();
}

export function formatHourLabel(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  const suffix = h < 12 ? 'AM' : 'PM';
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display} ${suffix}`;
}

export function formatDuration(ms: number): string {
  const totalMin = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export function formatHours(hours: number, decimals = 1): string {
  if (Number.isNaN(hours)) return '0h';
  if (hours < 0.1) return `${Math.round(hours * 60)}m`;
  return `${hours.toFixed(decimals)}h`;
}

export function startOfLocalDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

export function endOfLocalDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(23, 59, 59, 999);
  return c;
}

export function addDays(d: Date, n: number): Date {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}

// Monday-start week containing `d` (matches the rest of the app's weeks).
export function startOfWeek(d: Date): Date {
  const offset = (d.getDay() + 6) % 7; // 0 for Monday
  return startOfLocalDay(addDays(d, -offset));
}

// The 7 local dates (Mon..Sun) of the week containing `d`.
export function weekDays(d: Date): Date[] {
  const monday = startOfWeek(d);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

// Milliseconds of [startIso, endIso) that fall inside [dayStartMs, dayEndMs).
// Used to assign a block to a week column by overlap (so a block straddling
// midnight shows — clipped — in both days) and to total a day's lived time.
export function overlapMsWithin(
  startIso: string,
  endIso: string,
  dayStartMs: number,
  dayEndMs: number
): number {
  const s = new Date(startIso).getTime();
  const e = new Date(endIso).getTime();
  return Math.max(0, Math.min(e, dayEndMs) - Math.max(s, dayStartMs));
}

export function toIso(d: Date): string {
  return d.toISOString();
}

export function fromIso(s: string): Date {
  return new Date(s);
}

export function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function isoYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function fromIsoYmd(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// Parse loose time-of-day input like "9", "9p", "9pm", "21", "21:00", "9:30am",
// "0930", "21h", "13.5". Returns a Date on the provided contextDate, or null.
export function parseTimeInput(raw: string, contextDate: Date): Date | null {
  if (raw == null) return null;
  let s = String(raw).trim().toLowerCase().replace(/\s+/g, '');
  if (!s) return null;

  // pull off am/pm suffix (a, am, p, pm, am., etc.)
  let meridiem: 'am' | 'pm' | null = null;
  const mer = s.match(/(am?|pm?)\.?$/);
  if (mer) {
    meridiem = mer[1].startsWith('p') ? 'pm' : 'am';
    s = s.slice(0, -mer[1].length).replace(/\.$/, '');
  }
  // strip trailing 'h'
  s = s.replace(/h$/, '');
  if (!s) return null;

  let hour = NaN;
  let minute = 0;

  if (s.includes(':')) {
    const [hStr, mStr] = s.split(':');
    hour = parseInt(hStr, 10);
    minute = parseInt(mStr ?? '0', 10);
  } else if (s.includes('.')) {
    // 13.5 → 13:30
    const f = parseFloat(s);
    if (Number.isNaN(f)) return null;
    hour = Math.trunc(f);
    minute = Math.round((f - hour) * 60);
  } else if (/^\d{3,4}$/.test(s)) {
    // 0930 or 930 → 9:30
    const padded = s.padStart(4, '0');
    hour = parseInt(padded.slice(0, 2), 10);
    minute = parseInt(padded.slice(2), 10);
  } else if (/^\d{1,2}$/.test(s)) {
    hour = parseInt(s, 10);
    minute = 0;
  } else {
    return null;
  }

  if (Number.isNaN(hour) || Number.isNaN(minute)) return null;
  if (minute < 0 || minute >= 60) return null;

  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    if (meridiem === 'am') {
      if (hour === 12) hour = 0;
    } else {
      if (hour !== 12) hour += 12;
    }
  } else {
    if (hour < 0 || hour > 24) return null;
    if (hour === 24) {
      hour = 23;
      minute = 59;
    }
  }
  if (hour < 0 || hour > 23) return null;

  const d = new Date(contextDate);
  d.setHours(hour, minute, 0, 0);
  return d;
}

export function snapMinutes(d: Date, step: number): Date {
  const c = new Date(d);
  const minutes = c.getMinutes() + Math.round(c.getSeconds() / 60);
  const snapped = Math.round(minutes / step) * step;
  c.setMinutes(snapped, 0, 0);
  return c;
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function readableDate(d: Date): string {
  return d.toLocaleDateString([], {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

export function shortDate(d: Date): string {
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}
