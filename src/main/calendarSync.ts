import { createHash } from 'node:crypto';
import * as ical from 'node-ical';
import type { VEvent, EventInstance } from 'node-ical';
import { Blocks, Categories, getDb } from './db';
import { getSettings, updateSettings } from './settings';

// ICS sync — polls one or more private iCal URLs (e.g. Google
// Calendar's "secret address in iCal format") on an interval and
// reconciles a diff against existing Plan blocks with
// external_source matching that URL.
//
// Each URL has a stable per-URL identity (`gcal:<hash12 of url>`) so
// we can:
//   - distinguish events that happen to share the same UID across
//     calendars (extremely rare but possible),
//   - selectively remove the events for a single removed URL without
//     touching the others,
//   - skip deletion of a URL's blocks when that URL's fetch failed
//     this cycle (so a transient outage doesn't wipe events).

// `gcal:<12-hex-chars>`. Twelve chars of sha256 = ~48 bits of identity,
// effectively zero collision risk for the handful of URLs a user has.
const SOURCE_PREFIX = 'gcal:';
const WINDOW_PAST_DAYS = 1;
const WINDOW_FUTURE_DAYS = 7;
const FETCH_TIMEOUT_MS = 20_000;
const STARTUP_DELAY_MS = 5_000;
const FROM_CALENDAR_NAME = 'From calendar';
const FROM_CALENDAR_COLOR = '#6B7A8F';

let intervalId: NodeJS.Timeout | null = null;
let syncInFlight = false;

function urlToSource(url: string): string {
  return (
    SOURCE_PREFIX +
    createHash('sha256').update(url).digest('hex').slice(0, 12)
  );
}

export function startCalendarSync(): void {
  stopCalendarSync();
  const { gcalSyncIntervalMinutes } = getSettings();
  const intervalMs = Math.max(5, gcalSyncIntervalMinutes) * 60 * 1000;
  intervalId = setInterval(() => {
    void syncNow();
  }, intervalMs);
  setTimeout(() => {
    void syncNow();
  }, STARTUP_DELAY_MS);
}

export function stopCalendarSync(): void {
  if (intervalId != null) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

export function restartCalendarSyncTimer(): void {
  if (intervalId != null) {
    startCalendarSync();
  }
}

export async function syncNow(): Promise<{
  ok: boolean;
  error?: string;
  skipped?: boolean;
}> {
  // If a sync is already running (timer-driven, typically), don't
  // duplicate the work — but tell the caller we skipped so the UI
  // doesn't lie with a green "synced" toast.
  if (syncInFlight) return { ok: true, skipped: true };
  syncInFlight = true;
  try {
    return await syncOnce();
  } finally {
    syncInFlight = false;
  }
}

interface FetchedCalendar {
  url: string;
  source: string;
  desired: Map<string, DesiredInstance>;
}
interface DesiredInstance {
  start: Date;
  end: Date;
  summary: string | null;
}

async function syncOnce(): Promise<{ ok: boolean; error?: string }> {
  const settings = getSettings();
  const urls = settings.gcalIcsUrls;
  if (!urls.length) {
    if (settings.gcalLastSyncError != null) {
      updateSettings({ gcalLastSyncError: null });
    }
    return { ok: true };
  }

  // Ensure the "From calendar" category exists once per sync, before
  // we touch the DB for inserts.
  let categoryId = settings.gcalCategoryId;
  if (categoryId == null || !Categories.get(categoryId)) {
    categoryId = ensureFromCalendarCategory();
    updateSettings({ gcalCategoryId: categoryId });
  }

  // Fetch + parse each URL in parallel. allSettled so one slow/broken
  // URL doesn't block others; we collect per-URL outcomes.
  const fetches = await Promise.allSettled(
    urls.map(async (url): Promise<FetchedCalendar> => {
      const body = await fetchWithTimeout(url);
      const parsed = ical.parseICS(body);
      return {
        url,
        source: urlToSource(url),
        desired: collectDesired(parsed),
      };
    })
  );

  const successful: FetchedCalendar[] = [];
  const failures: { url: string; error: string }[] = [];
  for (let i = 0; i < fetches.length; i++) {
    const r = fetches[i];
    if (r.status === 'fulfilled') {
      successful.push(r.value);
    } else {
      const msg = describeError(r.reason);
      failures.push({ url: urls[i], error: msg });
    }
  }

  // Reconcile in one transaction across all SUCCESSFUL URLs. Failed
  // URLs are skipped entirely — we don't even consider their existing
  // blocks for deletion, since a network blip shouldn't wipe events.
  const db = getDb();
  const winStart = new Date();
  winStart.setDate(winStart.getDate() - WINDOW_PAST_DAYS);
  winStart.setHours(0, 0, 0, 0);
  const winEnd = new Date();
  winEnd.setDate(winEnd.getDate() + WINDOW_FUTURE_DAYS);
  winEnd.setHours(23, 59, 59, 999);
  const winStartIso = winStart.toISOString();
  const winEndIso = winEnd.toISOString();

  const upsertExisting = db.prepare(
    'SELECT id, detached FROM blocks WHERE external_source = ? AND external_id = ?'
  );
  const updateStmt = db.prepare(
    `UPDATE blocks
       SET category_id = ?, start_at = ?, end_at = ?, note = ?,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ?`
  );
  const insertStmt = db.prepare(
    `INSERT INTO blocks
       (category_id, start_at, end_at, note, kind, external_source, external_id)
     VALUES (?, ?, ?, ?, 'plan', ?, ?)`
  );
  const deleteStmt = db.prepare('DELETE FROM blocks WHERE id = ?');
  const overlappingActualStmt = db.prepare(
    "SELECT 1 FROM blocks " +
      "WHERE kind = 'actual' AND category_id = ? " +
      "AND start_at < ? AND end_at > ? LIMIT 1"
  );
  // To find blocks to consider for deletion we restrict to (a) the
  // sources of successfully-fetched URLs and (b) the time window. We
  // can't use SQL `IN (?)` with a variable list cleanly via prepared
  // statements; we'll filter in JS after a broader SELECT.
  const allWindowSynced = db.prepare(
    "SELECT id, external_source, external_id, start_at, end_at, " +
      "category_id, detached FROM blocks " +
      "WHERE external_source LIKE 'gcal:%' " +
      "AND start_at >= ? AND start_at <= ?"
  );

  const cat = categoryId;
  const successfulSources = new Set(successful.map((s) => s.source));

  const tx = db.transaction(() => {
    // 1) Upsert every desired instance from every successful URL.
    for (const cal of successful) {
      for (const [eid, d] of cal.desired) {
        const row = upsertExisting.get(cal.source, eid) as
          | { id: number; detached: number }
          | undefined;
        if (row) {
          if (row.detached) continue;
          updateStmt.run(
            cat,
            d.start.toISOString(),
            d.end.toISOString(),
            d.summary,
            row.id
          );
        } else {
          insertStmt.run(
            cat,
            d.start.toISOString(),
            d.end.toISOString(),
            d.summary,
            cal.source,
            eid
          );
        }
      }
    }

    // 2) Delete in-window blocks owned by a successful URL whose
    // external_id isn't in that URL's desired set. Skip detached
    // blocks and skip blocks whose source belongs to a URL that
    // failed this cycle (preserve, we don't know their state).
    const candidates = allWindowSynced.all(winStartIso, winEndIso) as {
      id: number;
      external_source: string | null;
      external_id: string | null;
      start_at: string;
      end_at: string;
      category_id: number;
      detached: number;
    }[];
    for (const row of candidates) {
      if (row.external_source == null || row.external_id == null) continue;
      if (row.detached) continue;
      if (!successfulSources.has(row.external_source)) continue;
      // Find the calendar this row belongs to.
      const cal = successful.find((s) => s.source === row.external_source);
      if (!cal) continue; // shouldn't happen
      if (cal.desired.has(row.external_id)) continue;
      const overlap = overlappingActualStmt.get(
        row.category_id,
        row.end_at,
        row.start_at
      );
      if (overlap) continue;
      deleteStmt.run(row.id);
    }
  });

  try {
    tx();
  } catch (err: any) {
    const msg = `DB error during sync: ${describeError(err)}`;
    updateSettings({ gcalLastSyncError: msg });
    return { ok: false, error: msg };
  }

  // Status: success unless all URLs failed; if some failed, surface a
  // compact message naming which.
  const lastSyncAt = new Date().toISOString();
  if (failures.length === 0) {
    updateSettings({ gcalLastSyncAt: lastSyncAt, gcalLastSyncError: null });
    return { ok: true };
  }
  const composite = composeErrorMessage(failures, urls.length);
  updateSettings({
    gcalLastSyncAt: lastSyncAt,
    gcalLastSyncError: composite,
  });
  // If at least one URL succeeded, return ok so the UI doesn't show
  // a global red banner — the per-URL error appears in the status line.
  return successful.length > 0
    ? { ok: true, error: composite }
    : { ok: false, error: composite };
}

async function fetchWithTimeout(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function describeError(err: unknown): string {
  if (err == null) return 'Unknown error';
  const e = err as { name?: string; message?: string };
  if (e.name === 'AbortError') return 'request timed out';
  return e.message ?? String(err);
}

function composeErrorMessage(
  failures: { url: string; error: string }[],
  totalUrls: number
): string {
  if (failures.length === totalUrls) {
    if (failures.length === 1) return failures[0].error;
    return `All ${failures.length} calendars failed (${failures[0].error}…)`;
  }
  if (failures.length === 1) {
    return `1 of ${totalUrls} calendars failed: ${failures[0].error}`;
  }
  return `${failures.length} of ${totalUrls} calendars failed (${failures[0].error}…)`;
}

function collectDesired(
  parsed: ical.CalendarResponse
): Map<string, DesiredInstance> {
  const now = new Date();
  const windowStart = new Date(now);
  windowStart.setDate(windowStart.getDate() - WINDOW_PAST_DAYS);
  windowStart.setHours(0, 0, 0, 0);
  const windowEnd = new Date(now);
  windowEnd.setDate(windowEnd.getDate() + WINDOW_FUTURE_DAYS);
  windowEnd.setHours(23, 59, 59, 999);

  const out = new Map<string, DesiredInstance>();
  for (const key of Object.keys(parsed)) {
    const comp = parsed[key];
    if (!comp || (comp as VEvent).type !== 'VEVENT') continue;
    const event = comp as VEvent;
    const instances = enumerateInstances(event, windowStart, windowEnd);
    for (const inst of instances) {
      if (inst.isFullDay) continue;
      const durMs = inst.end.getTime() - inst.start.getTime();
      if (durMs >= 24 * 60 * 60 * 1000) continue;
      if (durMs <= 0) continue;
      const eid = makeExternalId(event.uid, inst.start, inst.isRecurring);
      out.set(eid, {
        start: inst.start,
        end: inst.end,
        summary: paramText(inst.summary) || paramText(event.summary) || null,
      });
    }
  }
  return out;
}

function enumerateInstances(
  event: VEvent,
  from: Date,
  to: Date
): EventInstance[] {
  if (event.rrule) {
    try {
      return ical.expandRecurringEvent(event, { from, to });
    } catch {
      return [];
    }
  }
  if (!event.start || !event.end) return [];
  if (event.end < from || event.start > to) return [];
  return [
    {
      start: event.start,
      end: event.end,
      summary: event.summary,
      isFullDay: !!(event.start as any).dateOnly,
      isRecurring: false,
      isOverride: false,
      event,
    },
  ];
}

function makeExternalId(
  uid: string,
  start: Date,
  isRecurring: boolean
): string {
  return isRecurring ? `${uid}__${start.toISOString()}` : uid;
}

function paramText(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'string') return v.trim() || null;
  if (typeof v === 'object' && 'val' in (v as any)) {
    const s = (v as any).val;
    return typeof s === 'string' ? s.trim() || null : null;
  }
  return null;
}

function ensureFromCalendarCategory(): number {
  const all = Categories.list({ includeArchived: true });
  const found = all.find(
    (c) => c.name.trim().toLowerCase() === FROM_CALENDAR_NAME.toLowerCase()
  );
  if (found) return found.id;
  const created = Categories.create({
    name: FROM_CALENDAR_NAME,
    color: FROM_CALENDAR_COLOR,
  });
  return created.id;
}

/**
 * Remove a single URL from settings AND optionally remove its
 * non-detached synced blocks. Used by the Settings UI's per-URL ×
 * button.
 */
export function removeCalendarUrl(url: string): void {
  const source = urlToSource(url);
  const settings = getSettings();
  const next = settings.gcalIcsUrls.filter((u) => u !== url);
  // Always remove non-detached synced blocks for this URL — the user
  // explicitly removed the URL, so leaving its events behind would be
  // confusing.
  getDb()
    .prepare(
      "DELETE FROM blocks WHERE external_source = ? AND detached = 0"
    )
    .run(source);
  updateSettings({ gcalIcsUrls: next });
}

/**
 * Clear ALL URLs from settings; optionally also delete every synced
 * non-detached block. Detached blocks (user-edited) are always
 * preserved.
 */
export function disconnectCalendar({
  removeBlocks,
}: {
  removeBlocks: boolean;
}): void {
  if (removeBlocks) {
    // Delete every gcal-source synced non-detached block. We match
    // both the current multi-URL format ('gcal:<hash>') and the
    // legacy single-URL format ('gcal') — in case the v4 migration
    // didn't catch a stale row.
    getDb()
      .prepare(
        "DELETE FROM blocks " +
          "WHERE (external_source LIKE 'gcal:%' OR external_source = 'gcal') " +
          "AND detached = 0"
      )
      .run();
  }
  updateSettings({
    gcalIcsUrls: [],
    gcalLastSyncAt: null,
    gcalLastSyncError: null,
  });
}
