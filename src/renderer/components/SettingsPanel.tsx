import { useEffect, useState } from 'react';
import { ExternalLink, Keyboard, X } from 'lucide-react';
import type { AppPaths, AppSettings } from '@shared/types';
import { fromIso } from '../lib/time';

interface Props {
  settings: AppSettings;
  onClose: () => void;
  onUpdate: (partial: Partial<AppSettings>) => Promise<void> | void;
  onOpenShortcuts: () => void;
  onRefreshCategories: () => Promise<void> | void;
  onDataChanged: () => void;
}

export function SettingsPanel({
  settings,
  onClose,
  onUpdate,
  onOpenShortcuts,
  onRefreshCategories,
  onDataChanged,
}: Props) {
  const [paths, setPaths] = useState<AppPaths | null>(null);
  const [importPreview, setImportPreview] = useState<{
    categories: number;
    blocks: number;
    exported_at: string;
    path: string;
  } | null>(null);
  const [opMessage, setOpMessage] = useState<string | null>(null);

  useEffect(() => {
    window.api.paths.get().then(setPaths);
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/15 pt-16 pb-8">
      <div className="popover w-[540px] max-h-[80vh] overflow-y-auto p-6">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-lg font-medium">Settings</div>
            <div className="text-xs text-faint">v1 · Schema version 7</div>
          </div>
          <button
            className="btn btn-ghost p-1"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={15} strokeWidth={1.5} />
          </button>
        </div>

        <Section title="Appearance">
          <Row label="Theme">
            <select
              className="input-bare"
              value={settings.theme}
              onChange={(e) =>
                onUpdate({ theme: e.target.value as AppSettings['theme'] })
              }
            >
              <option value="system">Follow system</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </Row>
        </Section>

        <Section title="Day view">
          <Row label="Start hour">
            <select
              className="input-bare tabular-nums"
              value={settings.dayStartHour}
              onChange={(e) =>
                onUpdate({ dayStartHour: parseInt(e.target.value, 10) })
              }
            >
              {Array.from({ length: 24 }, (_, i) => i).map((h) => (
                <option key={h} value={h}>
                  {h.toString().padStart(2, '0')}:00
                </option>
              ))}
            </select>
          </Row>
          <Row label="End hour">
            <select
              className="input-bare tabular-nums"
              value={settings.dayEndHour}
              onChange={(e) =>
                onUpdate({ dayEndHour: parseInt(e.target.value, 10) })
              }
            >
              {Array.from({ length: 24 }, (_, i) => i + 1).map((h) => (
                <option key={h} value={h}>
                  {h === 24 ? '24:00' : h.toString().padStart(2, '0') + ':00'}
                </option>
              ))}
            </select>
          </Row>
        </Section>

        <Section title="Categories">
          <Row label="Show archived in sidebar">
            <input
              type="checkbox"
              checked={settings.showArchived}
              onChange={async (e) => {
                await onUpdate({ showArchived: e.target.checked });
                await onRefreshCategories();
              }}
            />
          </Row>
        </Section>

        {/* Defaults for new pomodoro sessions and planned sequences.
            Running sessions carry their own copies — changing these
            never affects a sequence already in flight. */}
        <Section title="Pomodoro">
          <Row label="Focus (minutes)">
            <PomodoroMinutesInput
              value={settings.pomodoroWorkMinutes}
              min={1}
              max={180}
              onCommit={(n) => onUpdate({ pomodoroWorkMinutes: n })}
            />
          </Row>
          <Row label="Break (minutes)">
            <PomodoroMinutesInput
              value={settings.pomodoroBreakMinutes}
              min={1}
              max={60}
              onCommit={(n) => onUpdate({ pomodoroBreakMinutes: n })}
            />
          </Row>
          <Row label="Long break (minutes)">
            <PomodoroMinutesInput
              value={settings.pomodoroLongBreakMinutes}
              min={1}
              max={60}
              onCommit={(n) => onUpdate({ pomodoroLongBreakMinutes: n })}
            />
          </Row>
          <Row label="Focuses per long break">
            <PomodoroMinutesInput
              value={settings.pomodorosPerCycle}
              min={1}
              max={12}
              onCommit={(n) => onUpdate({ pomodorosPerCycle: n })}
            />
          </Row>
        </Section>

        <Section title="Data">
          <div className="flex flex-wrap gap-2 mt-2">
            <button
              className="btn"
              onClick={async () => {
                setOpMessage(null);
                try {
                  const r = await window.api.export.json();
                  if (r.wrote) setOpMessage(`Exported to ${r.path}`);
                } catch (e: any) {
                  setOpMessage(`Export failed: ${e?.message ?? e}`);
                }
              }}
            >
              Export JSON
            </button>
            <button
              className="btn"
              onClick={async () => {
                setOpMessage(null);
                try {
                  const r = await window.api.export.csvZip();
                  if (r.wrote) setOpMessage(`Exported to ${r.path}`);
                } catch (e: any) {
                  setOpMessage(`Export failed: ${e?.message ?? e}`);
                }
              }}
            >
              Export CSV (zip)
            </button>
            <button
              className="btn"
              onClick={async () => {
                setOpMessage(null);
                setImportPreview(null);
                try {
                  const r = await window.api.import.json({ confirm: false });
                  if (!r.imported && (r as any).preview) {
                    setImportPreview((r as any).preview);
                  }
                } catch (e: any) {
                  setOpMessage(`Import error: ${e?.message ?? e}`);
                }
              }}
            >
              Import JSON…
            </button>
          </div>
          {opMessage && (
            <div className="mt-2 text-xs text-muted break-all">{opMessage}</div>
          )}
          {importPreview && (
            <div className="mt-3 p-3 border border-line rounded-md text-xs">
              <div className="font-medium mb-1">Replace all data?</div>
              <div className="text-muted">
                File: <span className="break-all">{importPreview.path}</span>
              </div>
              <div className="text-muted">
                Contains <span className="tabular-nums">{importPreview.categories}</span>{' '}
                categories and{' '}
                <span className="tabular-nums">{importPreview.blocks}</span> blocks
                (exported {importPreview.exported_at}).
              </div>
              <div className="text-[#A66E5C] mt-2">
                This will erase your current data.
              </div>
              <div className="mt-3 flex items-center gap-2">
                <button
                  className="btn"
                  onClick={() => setImportPreview(null)}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-primary"
                  onClick={async () => {
                    try {
                      const r = await window.api.import.json({ confirm: true });
                      setImportPreview(null);
                      if ((r as any).imported) {
                        setOpMessage(
                          `Imported ${(r as any).categories} categories, ${
                            (r as any).blocks
                          } blocks.`
                        );
                        await onRefreshCategories();
                        onDataChanged();
                      }
                    } catch (e: any) {
                      setOpMessage(`Import failed: ${e?.message ?? e}`);
                    }
                  }}
                >
                  Replace and import
                </button>
              </div>
            </div>
          )}
        </Section>

        {paths && (
          <Section title="Paths">
            <PathRow label="Database" path={paths.dbPath} />
            <PathRow label="Backup folder" path={paths.backupDir} />
            <PathRow label="Settings" path={paths.settingsPath} />
          </Section>
        )}

        <CalendarSyncSection
          settings={settings}
          onUpdate={onUpdate}
          onRefreshCategories={onRefreshCategories}
          onDataChanged={onDataChanged}
          onMessage={setOpMessage}
        />

        <PhoneLoggingSection settings={settings} onUpdate={onUpdate} />

        <Section title="Help">
          <button
            className="btn flex items-center gap-2 text-sm"
            onClick={onOpenShortcuts}
          >
            <Keyboard size={14} strokeWidth={1.5} />
            Keyboard shortcuts
          </button>
        </Section>
      </div>
    </div>
  );
}

interface CalendarSyncProps {
  settings: AppSettings;
  onUpdate: (partial: Partial<AppSettings>) => Promise<void> | void;
  onRefreshCategories: () => Promise<void> | void;
  onDataChanged: () => void;
  onMessage: (msg: string | null) => void;
}

// "Calendar sync" section. Manages a list of ICS URLs (a user can
// connect their work calendar, school calendar, etc.). Each URL has a
// per-URL × button; "Add another calendar" appends a new draft row.
function CalendarSyncSection({
  settings,
  onUpdate,
  onRefreshCategories,
  onDataChanged,
  onMessage,
}: CalendarSyncProps) {
  // Each row has a local draft so editing doesn't fire IPC per
  // keystroke. We commit on blur. New (unsaved) rows are tracked by a
  // sentinel — empty string in the drafts array.
  const [drafts, setDrafts] = useState<string[]>(settings.gcalIcsUrls);
  const [intervalDraft, setIntervalDraft] = useState(
    String(settings.gcalSyncIntervalMinutes)
  );
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [alsoRemove, setAlsoRemove] = useState(true);
  const [syncing, setSyncing] = useState(false);

  // Re-sync local drafts when settings change externally (e.g. legacy
  // migration on first launch, post-disconnect, post-removeUrl). We
  // compare both length AND positionally, so a URL rename via another
  // path is detected. If a user is mid-edit, the local draft will
  // diverge from settings — that's expected and the next blur will
  // overwrite settings with the user's intent.
  useEffect(() => {
    setDrafts((cur) => {
      const same =
        cur.length === settings.gcalIcsUrls.length &&
        cur.every((u, i) => u === settings.gcalIcsUrls[i]);
      if (same) return cur;
      return settings.gcalIcsUrls;
    });
  }, [settings.gcalIcsUrls]);
  useEffect(() => {
    setIntervalDraft(String(settings.gcalSyncIntervalMinutes));
  }, [settings.gcalSyncIntervalMinutes]);

  async function commitDraftsToSettings(next: string[]) {
    // Strip empty strings, dedupe, validate URLs. Invalid URLs are
    // dropped from the saved list AND surfaced via a toast — the
    // inline red border alone is too easy to miss when blur dismisses
    // the row.
    const clean: string[] = [];
    let droppedInvalid = 0;
    for (const url of next) {
      const trimmed = url.trim();
      if (!trimmed) continue;
      if (!isValidUrl(trimmed)) {
        droppedInvalid++;
        continue;
      }
      if (clean.includes(trimmed)) continue;
      clean.push(trimmed);
    }
    if (droppedInvalid > 0) {
      onMessage(
        droppedInvalid === 1
          ? "That URL didn't look valid — must start with https://"
          : `${droppedInvalid} URLs were invalid and dropped`
      );
    }
    // Detect URLs that were saved before but aren't in the new list —
    // user removed them (via × button) OR renamed (edited URL text).
    // Either way, delete their non-detached blocks so renamed URLs
    // don't leave orphans alongside the new URL's events.
    const removed = settings.gcalIcsUrls.filter((u) => !clean.includes(u));
    for (const url of removed) {
      try {
        await window.api.calendar.removeUrl({ url });
      } catch {
        // Ignore — the final onUpdate will still write the canonical
        // URL list. Orphaned blocks (if any) can be cleaned via
        // Disconnect.
      }
    }
    try {
      await onUpdate({ gcalIcsUrls: clean });
    } catch (err: any) {
      onMessage(err?.message ?? 'Could not save URLs');
    }
  }

  function updateDraft(idx: number, value: string) {
    setDrafts((cur) => cur.map((u, i) => (i === idx ? value : u)));
  }

  async function commitDraft(idx: number) {
    // On blur, save the whole array. This covers both adding a new
    // URL and editing an existing one.
    await commitDraftsToSettings(drafts);
  }

  function addRow() {
    setDrafts((cur) => [...cur, '']);
  }

  async function removeRow(idx: number) {
    const url = drafts[idx]?.trim();
    // Was this row already saved? If so, hit the dedicated remove
    // endpoint that also deletes the URL's non-detached blocks.
    if (url && settings.gcalIcsUrls.includes(url)) {
      try {
        await window.api.calendar.removeUrl({ url });
        // The settings update from removeUrl propagates back via the
        // settings prop, which our effect picks up.
        onDataChanged();
        // Optimistically drop from local drafts so the row disappears
        // immediately even before the prop change reaches us.
        setDrafts((cur) => cur.filter((_, i) => i !== idx));
      } catch (err: any) {
        onMessage(err?.message ?? 'Could not remove calendar');
      }
      return;
    }
    // Unsaved draft — just drop the row.
    setDrafts((cur) => cur.filter((_, i) => i !== idx));
  }

  async function saveInterval() {
    const n = parseInt(intervalDraft, 10);
    if (Number.isNaN(n)) {
      setIntervalDraft(String(settings.gcalSyncIntervalMinutes));
      return;
    }
    const clamped = Math.max(5, Math.min(720, n));
    if (clamped !== n) setIntervalDraft(String(clamped));
    if (clamped === settings.gcalSyncIntervalMinutes) return;
    try {
      await onUpdate({ gcalSyncIntervalMinutes: clamped });
    } catch (err: any) {
      onMessage(err?.message ?? 'Could not save interval');
    }
  }

  async function syncNow() {
    setSyncing(true);
    try {
      const res = await window.api.calendar.syncNow();
      if (res.skipped) {
        // A background sync was already running — don't claim
        // anything happened. The user can try again in a few seconds.
        onMessage('A sync is already running — try again shortly.');
      } else if (res.error) {
        // res.ok can still be true if some URLs succeeded — surface
        // any error message regardless.
        onMessage(res.error);
      } else if (res.ok) {
        onMessage('Calendars synced');
      }
      await onRefreshCategories();
      onDataChanged();
    } catch (err: any) {
      onMessage(err?.message ?? 'Sync failed');
    } finally {
      setSyncing(false);
    }
  }

  async function disconnect() {
    try {
      await window.api.calendar.disconnect({ removeBlocks: alsoRemove });
      onMessage(
        alsoRemove
          ? 'Calendars disconnected. Synced blocks removed.'
          : 'Calendars disconnected.'
      );
      setConfirmDisconnect(false);
      setDrafts([]);
      onDataChanged();
    } catch (err: any) {
      onMessage(err?.message ?? 'Disconnect failed');
    }
  }

  const hasAnyUrls = settings.gcalIcsUrls.length > 0;
  const lastSyncedLabel = settings.gcalLastSyncError
    ? settings.gcalLastSyncError
    : settings.gcalLastSyncAt
    ? `Last synced ${relativeTime(settings.gcalLastSyncAt)}`
    : 'Never synced';

  return (
    <Section title="Calendar sync">
      <div className="space-y-2">
        <div>
          <div className="text-sm mb-1">Calendars (ICS URLs)</div>
          <div className="space-y-1.5">
            {drafts.length === 0 && (
              <div className="text-[11.5px] text-faint italic">
                No calendars connected. Click "Add a calendar" below.
              </div>
            )}
            {drafts.map((url, idx) => {
              const trimmed = url.trim();
              const invalid = trimmed.length > 0 && !isValidUrl(trimmed);
              return (
                <div key={idx} className="flex items-center gap-2">
                  <input
                    className="input-bare flex-1 font-mono text-[11.5px]"
                    value={url}
                    onChange={(e) => updateDraft(idx, e.target.value)}
                    onBlur={() => commitDraft(idx)}
                    placeholder="https://calendar.google.com/calendar/ical/…/private-…/basic.ics"
                    spellCheck={false}
                    style={
                      invalid
                        ? { borderColor: '#A66E5C', color: '#A66E5C' }
                        : undefined
                    }
                  />
                  <button
                    className="btn btn-ghost p-1"
                    onClick={() => removeRow(idx)}
                    title="Remove this calendar"
                    aria-label="Remove this calendar"
                  >
                    <X size={13} strokeWidth={1.5} />
                  </button>
                </div>
              );
            })}
          </div>
          <button
            className="btn btn-ghost text-xs mt-2"
            onClick={addRow}
          >
            + Add a calendar
          </button>
          <div className="text-[11px] text-faint mt-2 leading-snug">
            Secret URLs — anyone with these URLs can read the
            corresponding calendar. Get one from Google Calendar →
            Settings & sharing →{' '}
            <span className="italic">Secret address in iCal format</span>{' '}
            (one URL per calendar; add as many as you need).
          </div>
        </div>

        <Row label="Sync interval (minutes)">
          <input
            type="number"
            className="input-bare w-[80px] tabular-nums text-right"
            min={5}
            max={720}
            value={intervalDraft}
            onChange={(e) => setIntervalDraft(e.target.value)}
            onBlur={saveInterval}
          />
        </Row>

        <Row label="Last synced">
          <span
            className="text-xs tabular-nums"
            style={{
              color: settings.gcalLastSyncError ? '#A66E5C' : 'var(--muted)',
            }}
          >
            {lastSyncedLabel}
          </span>
        </Row>

        <div className="flex items-center gap-2 pt-1">
          <button
            className="btn text-sm"
            onClick={syncNow}
            disabled={syncing || !hasAnyUrls}
          >
            {syncing ? 'Syncing…' : 'Sync now'}
          </button>
          {hasAnyUrls && !confirmDisconnect && (
            <button
              className="btn btn-ghost text-sm"
              onClick={() => setConfirmDisconnect(true)}
            >
              Disconnect all
            </button>
          )}
        </div>

        {confirmDisconnect && (
          <div className="surface-card p-3 mt-1">
            <div className="text-sm">Disconnect all calendars?</div>
            <label className="flex items-center gap-2 mt-2 text-xs text-muted">
              <input
                type="checkbox"
                checked={alsoRemove}
                onChange={(e) => setAlsoRemove(e.target.checked)}
              />
              Also remove synced Plan blocks (detached blocks are kept).
            </label>
            <div className="flex items-center gap-2 mt-3">
              <button
                className="btn btn-primary text-xs"
                onClick={disconnect}
              >
                Disconnect
              </button>
              <button
                className="btn btn-ghost text-xs"
                onClick={() => setConfirmDisconnect(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </Section>
  );
}

// "Phone logging" section — the Cloudflare relay. The Worker URL + token
// pair connects three parties: the phone web app POSTs entries, this app
// polls them down and pushes categories/phrases up for the preset chips.
function PhoneLoggingSection({
  settings,
  onUpdate,
}: {
  settings: AppSettings;
  onUpdate: (partial: Partial<AppSettings>) => Promise<void> | void;
}) {
  const [urlDraft, setUrlDraft] = useState(settings.phoneRelayUrl);
  const [tokenDraft, setTokenDraft] = useState(settings.phoneRelayToken);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  useEffect(() => setUrlDraft(settings.phoneRelayUrl), [settings.phoneRelayUrl]);
  useEffect(
    () => setTokenDraft(settings.phoneRelayToken),
    [settings.phoneRelayToken]
  );

  async function commitUrl() {
    const trimmed = urlDraft.trim();
    if (trimmed === settings.phoneRelayUrl) return;
    if (trimmed && !isValidUrl(trimmed)) {
      setTestResult("That URL didn't look valid — must start with https://");
      return;
    }
    await onUpdate({ phoneRelayUrl: trimmed });
  }

  async function commitToken() {
    const trimmed = tokenDraft.trim();
    if (trimmed !== settings.phoneRelayToken) {
      await onUpdate({ phoneRelayToken: trimmed });
    }
  }

  async function testConnection() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await window.api.phoneRelay.syncNow();
      setTestResult(
        res.ok ? 'Connected — presets pushed to the phone.' : res.error ?? 'Failed'
      );
    } catch (e: any) {
      setTestResult(e?.message ?? 'Test failed');
    } finally {
      setTesting(false);
    }
  }

  const configured =
    settings.phoneRelayUrl.trim() !== '' && settings.phoneRelayToken.trim() !== '';
  const phoneLink = configured
    ? `${settings.phoneRelayUrl.trim().replace(/\/+$/, '')}/#t=${settings.phoneRelayToken.trim()}`
    : null;
  const statusLabel = settings.phoneRelayLastError
    ? settings.phoneRelayLastError
    : settings.phoneRelayLastSyncAt
    ? `Last synced ${relativeTime(settings.phoneRelayLastSyncAt)}`
    : 'Never synced';

  return (
    <Section title="Phone logging">
      <div className="space-y-2">
        <Row label="Enabled">
          <input
            type="checkbox"
            checked={settings.phoneRelayEnabled}
            onChange={(e) => onUpdate({ phoneRelayEnabled: e.target.checked })}
          />
        </Row>
        <div>
          <div className="text-sm mb-1">Relay URL</div>
          <input
            className="input-bare w-full font-mono text-[11.5px]"
            value={urlDraft}
            onChange={(e) => setUrlDraft(e.target.value)}
            onBlur={commitUrl}
            placeholder="https://hourly-logger-relay.<you>.workers.dev"
            spellCheck={false}
          />
        </div>
        <div>
          <div className="text-sm mb-1">Relay token</div>
          <input
            className="input-bare w-full font-mono text-[11.5px]"
            value={tokenDraft}
            onChange={(e) => setTokenDraft(e.target.value)}
            onBlur={commitToken}
            placeholder="shared secret (matches the Worker's RELAY_TOKEN)"
            spellCheck={false}
          />
        </div>
        <Row label="Status">
          <span
            className="text-xs tabular-nums"
            style={{
              color: settings.phoneRelayLastError ? '#A66E5C' : 'var(--muted)',
            }}
          >
            {statusLabel}
          </span>
        </Row>
        <div className="flex items-center gap-2 pt-1">
          <button
            className="btn text-sm"
            onClick={testConnection}
            disabled={testing || !configured}
          >
            {testing ? 'Testing…' : 'Test connection'}
          </button>
          {phoneLink && (
            <button
              className="btn btn-ghost text-sm"
              onClick={() => navigator.clipboard.writeText(phoneLink)}
              title="Copy the phone setup link (includes the token)"
            >
              Copy phone link
            </button>
          )}
        </div>
        {testResult && (
          <div className="text-xs text-muted break-all">{testResult}</div>
        )}
        <div className="text-[11px] text-faint mt-2 leading-snug">
          Open the copied link on your iPhone (send it via AirDrop or
          Notes), then Share → <span className="italic">Add to Home
          Screen</span> for a one-tap logging app with your categories as
          presets. The link contains your secret token — share it with no
          one. See IPHONE-SETUP.md for the one-time Cloudflare setup.
        </div>
      </div>
    </Section>
  );
}

// Lightweight URL validation — accepts http(s) URLs. Mirrors what
// Zod's .url() accepts (which itself wraps `new URL()`). Done in the
// renderer so we can show inline feedback without an IPC roundtrip.
function isValidUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

// Render an ISO timestamp as "3 min ago" / "yesterday" / "5 days ago".
// Kept inline because it's only used here.
function relativeTime(iso: string): string {
  const then = fromIso(iso);
  const diffSec = Math.max(0, Math.floor((Date.now() - then.getTime()) / 1000));
  if (diffSec < 30) return 'just now';
  if (diffSec < 90) return '1 min ago';
  const min = Math.round(diffSec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const d = Math.round(hr / 24);
  if (d === 1) return 'yesterday';
  return `${d} days ago`;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6 first:mt-4">
      <div className="text-[11px] uppercase tracking-wider text-faint mb-2">
        {title}
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="text-sm">{label}</div>
      <div>{children}</div>
    </div>
  );
}

// Numeric setting that commits on blur/Enter, clamped to [min, max].
// Local state while typing so a half-typed "2" of "25" isn't persisted.
function PomodoroMinutesInput({
  value,
  min,
  max,
  onCommit,
}: {
  value: number;
  min: number;
  max: number;
  onCommit: (n: number) => Promise<void> | void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = () => {
    const n = parseInt(draft, 10);
    if (!Number.isFinite(n)) {
      setDraft(String(value));
      return;
    }
    const clamped = Math.max(min, Math.min(max, n));
    setDraft(String(clamped));
    if (clamped !== value) onCommit(clamped);
  };

  return (
    <input
      type="number"
      className="input-bare w-20 tabular-nums"
      min={min}
      max={max}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
      }}
    />
  );
}

function PathRow({ label, path }: { label: string; path: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="text-xs text-muted">{label}</div>
      <button
        className="text-xs flex items-center gap-1 text-ink hover:underline truncate max-w-[60%]"
        title={path}
        onClick={() => window.api.reveal(path)}
      >
        <span className="truncate">{path}</span>
        <ExternalLink size={11} strokeWidth={1.5} />
      </button>
    </div>
  );
}
