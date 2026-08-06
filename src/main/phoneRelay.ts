import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PhoneInboxEntry } from '@shared/types';
import { Blocks, Categories } from './db';
import { getAliases } from './aliases';
import { getPaths } from './paths';
import { getSettings, updateSettings } from './settings';
import { sendToMainWindow } from './windows';

// Phone relay — the Mac half of the Cloudflare-Worker phone integration
// (the no-Shortcuts successor to phoneInbox's iCloud file drop).
//
// The phone web app POSTs { id, text, ts } entries to a private Worker;
// this module polls them down and surfaces them through the SAME renderer
// drain as the iCloud inbox (ids are prefixed 'relay:' so markProcessed
// can route the ack back here). It also pushes a "catalog" — category
// names/colors plus learned capture phrases — up to the Worker so the
// phone can render preset chips.
//
// Durability mirrors phoneInbox: entries are acked (deleted server-side)
// only after the renderer reports a durable commit, and a local processed-
// ids ledger guarantees an entry can never import twice even if the ack
// is lost mid-flight.

const POLL_MS = 30_000;
const FETCH_TIMEOUT_MS = 10_000;
const LEDGER_CAP = 10_000;
const ID_PREFIX = 'relay:';
const MAX_PHRASES = 40;
// Recent-activity window pushed for the phone's mini timeline. Wider than
// the ~2h the phone renders, so the display window is always fully covered.
const RECENT_WINDOW_MS = 6 * 3_600_000;
const MAX_RECENT = 30;

let pollTimer: NodeJS.Timeout | null = null;
// Entry ids already surfaced to the renderer, so a poll only notifies when
// something genuinely new arrives (session-scoped; the ledger is the
// durable guard).
const seenIds = new Set<string>();
let lastCatalogJson: string | null = null;

interface RelayConfig {
  url: string; // normalized, no trailing slash
  token: string;
}

export function isRelayEntryId(id: string): boolean {
  return id.startsWith(ID_PREFIX);
}

function config(): RelayConfig | null {
  const s = getSettings();
  if (!s.phoneRelayEnabled) return null;
  const url = s.phoneRelayUrl.trim().replace(/\/+$/, '');
  const token = s.phoneRelayToken.trim();
  if (!url || !token) return null;
  return { url, token };
}

async function api(
  cfg: RelayConfig,
  path: string,
  init: { method?: string; body?: unknown } = {}
): Promise<any> {
  const res = await fetch(`${cfg.url}/api/${path}`, {
    method: init.method ?? 'GET',
    headers: {
      authorization: `Bearer ${cfg.token}`,
      'content-type': 'application/json',
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(
      res.status === 401
        ? 'Relay token rejected — check it matches the Worker secret.'
        : `Relay request failed (HTTP ${res.status})`
    );
  }
  return res.json();
}

// --- dedup ledger (same pattern as phoneInbox, separate file) ---

function ledgerPath(): string {
  return join(getPaths().appDataDir, 'phone-relay-state.json');
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
    // missing or corrupt — at worst an un-acked entry re-imports once.
  }
  return new Set();
}

function writeProcessed(ids: Set<string>): void {
  const capped = [...ids].slice(-LEDGER_CAP);
  const p = ledgerPath();
  const tmp = p + '.tmp';
  writeFileSync(tmp, JSON.stringify({ processedIds: capped }, null, 2), 'utf8');
  renameSync(tmp, p);
}

// --- public surface (called from ipc.ts) ---

// Fetch the Worker's pending entries, minus anything the ledger says was
// already imported. Fetches fresh on every call — the drain loop relies on
// a second call reflecting the acks from markProcessed.
export async function getPending(): Promise<PhoneInboxEntry[]> {
  const cfg = config();
  if (!cfg) return [];
  let entries: Array<{ id: string; text: string; ts: string | null }>;
  try {
    const data = await api(cfg, 'entries');
    entries = Array.isArray(data?.entries) ? data.entries : [];
    clearError();
    setLastSync();
  } catch (err) {
    setError(describe(err));
    return [];
  }
  const processed = readProcessed();
  return entries
    .filter((e) => typeof e?.id === 'string' && typeof e?.text === 'string')
    .filter((e) => !processed.has(e.id))
    .map((e) => ({
      id: ID_PREFIX + e.id,
      ts: typeof e.ts === 'string' ? e.ts : null,
      text: e.text,
    }));
}

// Called (via the ipc router) after the renderer durably committed these
// entries. Ledger first — the ack is best-effort; if it's lost the entry
// lingers server-side but the ledger keeps it from ever importing again.
export async function markProcessed(prefixedIds: string[]): Promise<void> {
  const ids = prefixedIds
    .filter((id) => id.startsWith(ID_PREFIX))
    .map((id) => id.slice(ID_PREFIX.length));
  if (ids.length === 0) return;
  const set = readProcessed();
  for (const id of ids) set.add(id);
  writeProcessed(set);
  const cfg = config();
  if (cfg) {
    try {
      await api(cfg, 'entries/ack', { method: 'POST', body: { ids } });
    } catch {
      // Ledger above already protects against re-import; the entries are
      // re-acked implicitly next time (they'll be filtered + re-acked on
      // a future markProcessed) or simply linger harmlessly.
    }
  }
  updateSettings({ phoneInboxLastImportAt: new Date().toISOString() });
}

// --- catalog push (Mac → phone preset chips) ---

function buildCatalog(): {
  categories: Array<{ name: string; color: string }>;
  phrases: Array<{ text: string; color: string | null }>;
  recent: Array<{
    name: string;
    color: string;
    start: string;
    end: string;
    note: string | null;
  }>;
} {
  const s = getSettings();
  // Routing-only categories make useless chips — tapping "Phone log"
  // or "From calendar" isn't something anyone means to log.
  const hidden = new Set(
    [s.phoneInboxCategoryId, s.gcalCategoryId].filter((x) => x != null)
  );
  const cats = Categories.list({ includeArchived: false }).filter(
    (c) => !hidden.has(c.id)
  );
  const colorById = new Map(cats.map((c) => [c.id, c.color]));
  // Most recently learned phrases first — the alias file is a JSON map in
  // insertion order, so the tail is the newest.
  const phrases = getAliases()
    .slice(-MAX_PHRASES)
    .reverse()
    .map((a) => ({
      phrase: a.phrase,
      color: colorById.get(a.categoryId) ?? null,
    }));
  // Recent actual blocks, for the phone's "last 2 hours" mini view. Name
  // resolution includes archived + routing categories — a block can point
  // at either, and the mini view should still label it honestly.
  const now = Date.now();
  const allCats = new Map(
    Categories.list({ includeArchived: true }).map((c) => [c.id, c])
  );
  const recent = Blocks.listByRange({
    from: new Date(now - RECENT_WINDOW_MS).toISOString(),
    to: new Date(now).toISOString(),
  })
    .filter((b) => b.kind === 'actual')
    .slice(-MAX_RECENT)
    .map((b) => ({
      name: allCats.get(b.category_id)?.name ?? 'Unknown',
      color: allCats.get(b.category_id)?.color ?? '#8A8177',
      start: b.start_at,
      end: b.end_at,
      note: b.note,
    }));
  return {
    categories: cats.map((c) => ({ name: c.name, color: c.color })),
    phrases: phrases.map((p) => ({ text: p.phrase, color: p.color })),
    recent,
  };
}

async function pushCatalog(cfg: RelayConfig, force = false): Promise<void> {
  const catalog = buildCatalog();
  const body = JSON.stringify(catalog);
  if (!force && body === lastCatalogJson) return;
  await api(cfg, 'catalog', {
    method: 'POST',
    body: { ...catalog, updatedAt: new Date().toISOString() },
  });
  lastCatalogJson = body;
}

// --- lifecycle (called from index.ts / ipc.ts) ---

async function poll(): Promise<void> {
  const cfg = config();
  if (!cfg) return;
  try {
    const data = await api(cfg, 'entries');
    const entries: Array<{ id: string }> = Array.isArray(data?.entries)
      ? data.entries
      : [];
    clearError();
    setLastSync();
    const processed = readProcessed();
    const fresh = entries.filter(
      (e) => typeof e?.id === 'string' && !processed.has(e.id)
    );
    const hasUnseen = fresh.some((e) => !seenIds.has(e.id));
    for (const e of fresh) seenIds.add(e.id);
    if (hasUnseen) sendToMainWindow('phoneInbox:new', null);
    await pushCatalog(cfg);
  } catch (err) {
    setError(describe(err));
  }
}

export function startPhoneRelay(): void {
  stopPhoneRelay();
  if (!config()) return;
  pollTimer = setInterval(() => void poll(), POLL_MS);
  void poll(); // surface anything logged while the app was closed
}

export function stopPhoneRelay(): void {
  if (pollTimer != null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

// Restart after a settings change (enable/disable, URL, token).
export function restartPhoneRelay(): void {
  lastCatalogJson = null; // re-push against the (possibly new) Worker
  startPhoneRelay();
}

// One-shot connectivity test + immediate sync, for the Settings panel.
// Force-pushes the catalog so the phone gets its chips right away.
export async function syncNow(): Promise<{ ok: boolean; error?: string }> {
  const s = getSettings();
  if (!s.phoneRelayUrl.trim() || !s.phoneRelayToken.trim()) {
    return { ok: false, error: 'Set the relay URL and token first.' };
  }
  const cfg: RelayConfig = {
    url: s.phoneRelayUrl.trim().replace(/\/+$/, ''),
    token: s.phoneRelayToken.trim(),
  };
  try {
    await api(cfg, 'ping');
    await pushCatalog(cfg, true);
    updateSettings({
      phoneRelayLastSyncAt: new Date().toISOString(),
      phoneRelayLastError: null,
    });
    // Nudge the renderer to drain whatever's pending server-side.
    sendToMainWindow('phoneInbox:new', null);
    return { ok: true };
  } catch (err) {
    const msg = describe(err);
    setError(msg);
    return { ok: false, error: msg };
  }
}

// --- internals ---

// Stamp "last synced" at most once a minute — the poll fires every 30s and
// each updateSettings rewrites settings.json; no need to churn the disk
// for a status line rendered as "N min ago".
function setLastSync(): void {
  const prev = getSettings().phoneRelayLastSyncAt;
  const now = Date.now();
  if (prev && now - Date.parse(prev) < 60_000) return;
  updateSettings({ phoneRelayLastSyncAt: new Date(now).toISOString() });
}

function setError(msg: string): void {
  if (getSettings().phoneRelayLastError !== msg) {
    updateSettings({ phoneRelayLastError: msg });
  }
}

function clearError(): void {
  if (getSettings().phoneRelayLastError !== null) {
    updateSettings({ phoneRelayLastError: null });
  }
}

function describe(err: unknown): string {
  const e = err as { message?: string; name?: string };
  if (e?.name === 'TimeoutError') return 'Relay request timed out.';
  return e?.message ?? String(err);
}
