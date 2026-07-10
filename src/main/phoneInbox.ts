import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  watch,
  writeFileSync,
  type FSWatcher,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { phoneInboxFileSchema } from '@shared/schema';
import type { PhoneInboxEntry } from '@shared/types';
import { Categories } from './db';
import { getPaths } from './paths';
import { getSettings, updateSettings } from './settings';
import { sendToMainWindow } from './windows';

// Phone inbox — the Mac half of "log from your iPhone".
//
// An iOS Shortcut drops one tiny JSON file per entry ({ text, ts }) into
// <folder>/inbox in iCloud Drive. iCloud syncs the file across; this
// module watches the folder and surfaces pending files to the RENDERER,
// which parses them with the existing capture parser and commits them via
// the existing capture.commit path (so nothing about parsing or block
// creation is duplicated here). After a successful import the renderer
// calls markProcessed(), which records the id and files the JSON away
// under processed/.
//
// Why files-per-entry instead of one appended log: iOS Shortcuts has no
// reliable append action, and a read-modify-write of a shared file would
// race. A unique-named file per entry can never collide and makes dedup
// trivial.

const DEFAULT_FOLDER_NAME = 'HourlyLogger';
const POLL_MS = 15_000; // backstop — fs.watch on iCloud files is flaky
const WATCH_DEBOUNCE_MS = 400;
const LEDGER_CAP = 10_000;

// Auto-created home for entries that match no existing category. Stored by
// id in settings (phoneInboxCategoryId) so a rename never breaks routing —
// same approach as the "From calendar" category.
const INBOX_CATEGORY_NAME = 'Phone log';
const INBOX_CATEGORY_COLOR = '#7F6A54'; // Mushroom, from the palette

interface InboxDirs {
  base: string;
  inbox: string;
  processed: string;
  failed: string;
}

let watcher: FSWatcher | null = null;
let pollTimer: NodeJS.Timeout | null = null;
let notifyTimer: NodeJS.Timeout | null = null;

// --- path resolution ---

function iCloudBase(): string {
  return join(
    homedir(),
    'Library',
    'Mobile Documents',
    'com~apple~CloudDocs'
  );
}

function resolveBase(): { base: string; usingDefault: boolean } {
  const configured = getSettings().phoneInboxFolderPath.trim();
  if (configured) return { base: configured, usingDefault: false };
  return { base: join(iCloudBase(), DEFAULT_FOLDER_NAME), usingDefault: true };
}

// Resolve + create the inbox/processed/failed folders. Returns null (and
// records a user-facing error) when the location can't be used — e.g.
// iCloud Drive isn't enabled and no custom folder was set.
function ensureDirs(): InboxDirs | null {
  const { base, usingDefault } = resolveBase();
  if (usingDefault && !existsSync(iCloudBase())) {
    setError(
      'iCloud Drive not found — enable iCloud Drive, or set a custom phone-inbox folder in settings.'
    );
    return null;
  }
  const dirs: InboxDirs = {
    base,
    inbox: join(base, 'inbox'),
    processed: join(base, 'processed'),
    failed: join(base, 'failed'),
  };
  try {
    mkdirSync(dirs.inbox, { recursive: true });
    mkdirSync(dirs.processed, { recursive: true });
    mkdirSync(dirs.failed, { recursive: true });
  } catch (err) {
    setError(`Couldn't create the phone-inbox folder: ${describe(err)}`);
    return null;
  }
  return dirs;
}

// --- dedup ledger (atomic JSON in app-data, NOT in iCloud) ---

function ledgerPath(): string {
  return join(getPaths().appDataDir, 'phone-inbox-state.json');
}

function readProcessed(): Set<string> {
  try {
    const raw = JSON.parse(readFileSync(ledgerPath(), 'utf8'));
    if (raw && Array.isArray(raw.processedIds)) {
      return new Set(
        raw.processedIds.filter((x: unknown): x is string => typeof x === 'string')
      );
    }
  } catch {
    // missing or corrupt — treat as empty; nothing is lost, at worst a
    // file is re-imported once.
  }
  return new Set();
}

function writeProcessed(ids: Set<string>): void {
  // Cap so the ledger can't grow without bound; processed files are moved
  // out of inbox/, so a dropped-oldest id won't reappear there.
  const capped = [...ids].slice(-LEDGER_CAP);
  const p = ledgerPath();
  const tmp = p + '.tmp';
  writeFileSync(tmp, JSON.stringify({ processedIds: capped }, null, 2), 'utf8');
  renameSync(tmp, p);
}

function recordProcessed(ids: string[]): void {
  if (ids.length === 0) return;
  const set = readProcessed();
  for (const id of ids) set.add(id);
  writeProcessed(set);
}

// --- public surface (called from ipc.ts) ---

// Read every not-yet-imported file from inbox/. Files that are present but
// already in the ledger (e.g. lingering because an iCloud delete hasn't
// propagated) are skipped. Unparseable files are filed under failed/ and
// recorded so they're never retried.
export function getPending(): PhoneInboxEntry[] {
  const dirs = ensureDirs();
  if (!dirs) return [];
  clearError();

  const processed = readProcessed();
  let names: string[];
  try {
    names = readdirSync(dirs.inbox).filter((n) => n.toLowerCase().endsWith('.json'));
  } catch (err) {
    setError(`Couldn't read the phone inbox: ${describe(err)}`);
    return [];
  }

  const out: PhoneInboxEntry[] = [];
  for (const name of names) {
    const id = name.replace(/\.json$/i, '');
    if (processed.has(id)) continue;
    const full = join(dirs.inbox, name);

    let raw: string;
    try {
      raw = readFileSync(full, 'utf8');
    } catch {
      // Transient — e.g. an iCloud placeholder still downloading. Leave it
      // and try again on the next scan.
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      consumeFailed(dirs, id, full);
      continue;
    }
    const res = phoneInboxFileSchema.safeParse(parsed);
    if (!res.success) {
      consumeFailed(dirs, id, full);
      continue;
    }
    // Prefer the Shortcut-stamped capture time; fall back to the file's
    // mtime (≈ when the entry was created on the phone) rather than "now",
    // so a delayed iCloud sync doesn't land the block at import time.
    let ts = res.data.ts ?? null;
    if (!ts) {
      try {
        ts = statSync(full).mtime.toISOString();
      } catch {
        ts = null;
      }
    }
    out.push({ id, ts, text: res.data.text });
  }

  // Oldest first by capture time, then id — so the imported blocks land on
  // the timeline in the order they were logged.
  out.sort((a, b) => {
    const ta = a.ts ? Date.parse(a.ts) : 0;
    const tb = b.ts ? Date.parse(b.ts) : 0;
    if (!Number.isNaN(ta) && !Number.isNaN(tb) && ta !== tb) return ta - tb;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return out;
}

// Called by the renderer after it has durably committed these entries as
// blocks. Files them under processed/ and records the ids so a later scan
// can't re-import them.
export function markProcessed(ids: string[]): void {
  const dirs = ensureDirs();
  if (dirs) {
    for (const id of ids) {
      const from = join(dirs.inbox, `${id}.json`);
      const to = join(dirs.processed, `${id}.json`);
      try {
        renameSync(from, to);
      } catch {
        // Already moved/gone — the ledger below is the real safeguard.
      }
    }
  }
  recordProcessed(ids);
  updateSettings({ phoneInboxLastImportAt: new Date().toISOString() });
}

// Resolve (creating if needed) the "Phone log" category for entries that
// match nothing. Mirrors calendarSync's ensureFromCalendarCategory.
export function ensureInboxCategory(): number {
  const existingId = getSettings().phoneInboxCategoryId;
  if (existingId != null && Categories.get(existingId)) return existingId;
  const all = Categories.list({ includeArchived: true });
  const found = all.find(
    (c) => c.name.trim().toLowerCase() === INBOX_CATEGORY_NAME.toLowerCase()
  );
  const id = found
    ? found.id
    : Categories.create({
        name: INBOX_CATEGORY_NAME,
        color: INBOX_CATEGORY_COLOR,
      }).id;
  updateSettings({ phoneInboxCategoryId: id });
  return id;
}

// --- lifecycle (called from index.ts) ---

export function startPhoneInbox(): void {
  stopPhoneInbox();
  if (!getSettings().phoneInboxEnabled) return;
  const dirs = ensureDirs();
  if (!dirs) return; // ensureDirs recorded why

  try {
    watcher = watch(dirs.inbox, { persistent: false }, () => scheduleNotify());
  } catch {
    // Some filesystems reject fs.watch; the poll backstop still works.
  }
  pollTimer = setInterval(() => notifyNew(), POLL_MS);
  // Surface anything that arrived while the app was closed as soon as a
  // window is present.
  notifyNew();
}

export function stopPhoneInbox(): void {
  if (watcher) {
    watcher.close();
    watcher = null;
  }
  if (pollTimer != null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (notifyTimer != null) {
    clearTimeout(notifyTimer);
    notifyTimer = null;
  }
}

// Restart the watcher after a settings change (enable/disable, folder).
export function restartPhoneInbox(): void {
  startPhoneInbox();
}

// --- internals ---

function consumeFailed(dirs: InboxDirs, id: string, full: string): void {
  try {
    renameSync(full, join(dirs.failed, `${id}.json`));
  } catch {
    // Leave it; the ledger record below still prevents a retry loop.
  }
  recordProcessed([id]);
}

// fs.watch fires several events per change; coalesce them.
function scheduleNotify(): void {
  if (notifyTimer != null) clearTimeout(notifyTimer);
  notifyTimer = setTimeout(() => {
    notifyTimer = null;
    notifyNew();
  }, WATCH_DEBOUNCE_MS);
}

// Nudge the renderer to drain. A no-op if no window is open — the renderer
// also drains on mount and on focus, so closed-window entries are caught
// when a window next appears.
function notifyNew(): void {
  sendToMainWindow('phoneInbox:new', null);
}

function setError(msg: string): void {
  if (getSettings().phoneInboxLastError !== msg) {
    updateSettings({ phoneInboxLastError: msg });
  }
}

function clearError(): void {
  if (getSettings().phoneInboxLastError !== null) {
    updateSettings({ phoneInboxLastError: null });
  }
}

function describe(err: unknown): string {
  const e = err as { message?: string };
  return e?.message ?? String(err);
}
