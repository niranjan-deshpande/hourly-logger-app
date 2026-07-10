export type ID = number;

export interface Category {
  id: ID;
  name: string;
  color: string;
  archived: boolean;
  created_at: string;
}

// --- Goals (v8) ---
// Goals moved off `categories` into their own effective-dated table. A
// weekly minutes target, an every-day habit, or an N-days-per-week habit.
export type GoalKind = 'weekly_minutes' | 'daily_habit' | 'weekly_frequency';

// One goal *revision*: it applies to local days in [effective_from,
// retired_from); retired_from IS NULL means active. `target` means
// minutes/week for weekly_minutes, always 1 for daily_habit, and days/week
// (1–6) for weekly_frequency. Dates are local YYYY-MM-DD.
export interface Goal {
  id: ID;
  category_id: ID;
  kind: GoalKind;
  target: number;
  effective_from: string;
  retired_from: string | null;
  created_at: string;
}

// A day exempted from a habit so it doesn't break streaks. Keyed by
// category (not goal) so exemptions survive goal revisions.
export interface GoalExemption {
  category_id: ID;
  date: string; // local YYYY-MM-DD
}

// Whether a block represents intent (plan, drafted in the morning) or
// what actually happened (actual, the source of truth for stats).
export type BlockKind = 'plan' | 'actual';

// Pomodoro metadata carried by a block (nullable JSON column). A plan
// block with PomodoroPlanMeta is a launchable planned sequence; an
// actual block with PomodoroActualMeta is the single continuous block a
// finished live sequence wrote (breaks included — they count as the
// category's time).
export interface PomodoroPlanMeta {
  workMinutes: number;
  breakMinutes: number;
  reps: number;
}

export interface PomodoroActualMeta {
  source: 'pomodoro';
  repsCompleted: number;
  workMinutes: number;
  breakMinutes: number;
}

export type BlockPomodoro = PomodoroPlanMeta | PomodoroActualMeta;

export interface Block {
  id: ID;
  category_id: ID;
  start_at: string; // ISO 8601 UTC
  end_at: string;
  note: string | null;
  kind: BlockKind;
  // Provenance for synced blocks. `external_source` namespaces the id
  // space (currently only 'gcal'); together with `external_id` it
  // uniquely identifies a synced block across sync runs. Both null for
  // user-created blocks.
  external_source: string | null;
  external_id: string | null;
  // Once a user edits a synced block in HL, this flips to true and
  // the sync engine never updates or deletes the block again.
  detached: boolean;
  pomodoro: BlockPomodoro | null;
  created_at: string;
  updated_at: string;
}

export interface AppSettings {
  dayStartHour: number; // 0..23
  dayEndHour: number; // 1..24
  theme: 'light' | 'dark' | 'system';
  showArchived: boolean;
  // Google Calendar (or any ICS source) sync configuration. Multiple
  // URLs are allowed — they all feed into the single "From calendar"
  // category. Each URL has its own per-URL identity in the DB so we
  // can remove an individual URL's events without touching others.
  gcalIcsUrls: string[];
  gcalSyncIntervalMinutes: number; // min 5
  // The auto-created "From calendar" category's id, populated on first
  // sync. We store id rather than name so the user can rename the
  // category without breaking sync identity.
  gcalCategoryId: ID | null;
  gcalLastSyncAt: string | null; // ISO, for the "Last synced" status
  gcalLastSyncError: string | null; // cleared on every successful sync
  // Pomodoro defaults — seed the start popover and plan-sequence editor.
  // Per-session values are copied into the active session at start, so
  // changing these never affects a running sequence.
  pomodoroWorkMinutes: number;
  pomodoroBreakMinutes: number;
  pomodoroLongBreakMinutes: number;
  pomodorosPerCycle: number;
  // Phone inbox (iPhone → iCloud → here). An iOS Shortcut drops small
  // JSON files into <folder>/inbox; the app auto-imports them as Actual
  // blocks. Off-switch defaults on; if iCloud Drive isn't present the
  // watcher silently no-ops and records phoneInboxLastError.
  phoneInboxEnabled: boolean;
  // Empty = use the default iCloud Drive path
  // (~/Library/Mobile Documents/com~apple~CloudDocs/HourlyLogger).
  phoneInboxFolderPath: string;
  // Auto-created "Phone log" category for entries that match no existing
  // category. Stored as id (not name) so a rename can't break routing —
  // same pattern as gcalCategoryId.
  phoneInboxCategoryId: ID | null;
  // Fallback block length (minutes) for a timeless entry ("deep work"
  // with no clock time): start = when it was logged, end = start + this.
  phoneInboxDefaultMinutes: number;
  phoneInboxLastImportAt: string | null; // ISO, for a "Last imported" status
  phoneInboxLastError: string | null; // cleared on a clean scan
}

export interface AppPaths {
  dbPath: string;
  backupDir: string;
  settingsPath: string;
  appDataDir: string;
}

// 'awaiting' = a break ended and no timer runs; waiting for the user to
// start the next rep or finish the session.
export type PomodoroPhase = 'work' | 'break' | 'awaiting';

// Pomodoro machine state, persisted inside the active-session file on
// every transition so a crash mid-sequence is recoverable from disk.
export interface ActiveSessionPomodoro {
  workMinutes: number;
  breakMinutes: number;
  longBreakMinutes: number;
  pomodorosPerCycle: number;
  phase: PomodoroPhase;
  phaseEndsAt: string | null; // ISO; null while 'awaiting' or paused
  isPaused: boolean;
  pausedRemainingSeconds: number | null;
  repsCompleted: number;
  // Stamped at every work/break completion. Finishing from 'awaiting'
  // ends the block here, not at "now" (walk-away rule).
  lastPhaseEndAt: string | null;
  isExtension: boolean;
  planBlockId: ID | null;
  // One-shot overrides for the NEXT focus/break phase; consumed and
  // cleared when that phase starts. Session params stay the defaults.
  nextWorkMinutes: number | null;
  nextBreakMinutes: number | null;
}

// A live recording in progress. Persisted as a small JSON file on disk so
// that closing the app mid-session doesn't lose it — on next launch we can
// offer to commit or discard it. `pomodoro` is present only for pomodoro
// sessions; plain stopwatch recordings never set it.
export interface ActiveSession {
  startAt: string; // ISO 8601 UTC
  categoryId: ID;
  note: string | null;
  pomodoro?: ActiveSessionPomodoro;
}

// Live countdown state, owned by the main-process timer and mirrored to
// renderers at 1 Hz over `pomodoro.tick`. 'idle' means no timer runs —
// either no pomodoro session exists or it's in the 'awaiting' phase.
export interface PomodoroTimerState {
  remaining: number; // seconds
  total: number; // seconds
  type: 'idle' | 'work' | 'break';
  isPaused: boolean;
}

// What the renderer gets from pomodoro.getState / every pomodoro.tick.
// The machine state (phase, reps, …) lives in session.pomodoro.
export interface PomodoroSnapshot {
  session: ActiveSession | null;
  timer: PomodoroTimerState;
}

// Session context shown on the break-cover windows.
export interface PomodoroCoverSession {
  repsCompleted: number;
  pomodorosPerCycle: number;
  categoryName: string;
  categoryColor: string;
  note: string | null;
}

// Payload of the `cover:show` push. `focusMinutes` labels the
// "Start Focus (N min)" button.
export type CoverShowPayload =
  | {
      mode: 'break';
      breakType: 'short' | 'long';
      state: PomodoroTimerState;
      session: PomodoroCoverSession;
      focusMinutes: number;
    }
  | {
      mode: 'breakOver';
      session: PomodoroCoverSession;
      focusMinutes: number;
    };

// --- Per-day energy & journal (v7) ---

// How a whole day felt, on a 2-axis affect model (energy × pleasantness)
// surfaced as five one-tap presets. 'fine' is the neutral middle.
export type DayEnergy = 'flow' | 'calm' | 'fine' | 'drained' | 'stressed';

// One day's reflective record: an optional energy preset and an optional
// short (1–3 sentence) journal entry, keyed by local calendar date. This
// is real user data — it round-trips through export/import and backups.
export interface DayRecord {
  date: string; // 'YYYY-MM-DD', local day
  energy: DayEnergy | null;
  journal: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExportV1 {
  format: 'hourly-logger-export';
  version: 1;
  exported_at: string;
  categories: Category[];
  blocks: Block[];
  days: DayRecord[];
  goals: Goal[];
  goal_exemptions: GoalExemption[];
}

export interface ImportResult {
  categories: number;
  blocks: number;
}

export type DialogResult<T> = { ok: true; value: T } | { ok: false; reason: string };

// --- Phone inbox (iPhone → iCloud) ---

// One pending phone-logged entry, read from a JSON file the iOS Shortcut
// dropped into the iCloud inbox folder. `id` is the file's basename (a
// UUID), which also serves as the dedup key. `ts` is the capture time;
// null falls back to the file's mtime at read.
export interface PhoneInboxEntry {
  id: string;
  ts: string | null; // ISO 8601
  text: string;
}

// --- Quick capture (natural-language → block drafts) ---

// A learned phrase→category association, persisted to aliases.json so the
// rules parser improves over time: when the user explicitly assigns a
// category to a phrase in the capture review, that mapping is remembered
// and applied (highest priority) on future parses.
export interface AliasEntry {
  phrase: string; // normalized: lowercased, punctuation-stripped, collapsed
  categoryId: ID;
}

// Why a parsed draft needs the user's attention before commit. None of
// these block commit on their own — they're surfaced as chips in review.
export type CaptureWarning =
  | 'no-start'
  | 'no-end'
  | 'end-before-start'
  | 'overlaps-existing'
  | 'clamped-to-now'
  | 'in-future';

// One proposed block produced by the parser, pre-commit and fully
// editable in the review UI. Times are null when the parser couldn't
// resolve one — the row flags it for the user to fill.
export interface CaptureDraft {
  tempId: string;
  startAt: string | null; // ISO 8601 UTC
  endAt: string | null;
  categoryId: ID | null; // matched existing category
  newCategoryName: string | null; // proposed new category (no match)
  newCategoryColor: string | null; // nextColor() suggestion for the above
  note: string | null;
  kind: BlockKind;
  rawText: string; // the full source segment, shown for traceability
  // The normalized activity phrase (time expression removed). Used as the
  // alias key when this row is "taught".
  rawPhrase: string;
  warnings: CaptureWarning[];
  // True once the user has manually set/confirmed this row's category
  // (remap, or accepting a proposed new category). Drives alias learning.
  taught: boolean;
  // The category was auto-filled from a learned alias (a phrase the user
  // assigned before). Surfaced as a subtle "remembered" hint in review.
  viaAlias: boolean;
}

export interface CaptureResult {
  drafts: CaptureDraft[];
  // Segments the parser couldn't make sense of at all — surfaced in the
  // UI so nothing is silently dropped.
  leftovers: string[];
}

// A fully-resolved draft the renderer sends to the main process to
// commit. Exactly one of categoryId / newCategory is set.
export interface CommitDraft {
  startAt: string;
  endAt: string;
  categoryId: ID | null;
  newCategory: { name: string; color: string } | null;
  note: string | null;
  kind: BlockKind;
  // The normalized source phrase + whether to learn it as an alias for
  // the resolved category. Recorded after the block is created.
  rawPhrase: string;
  teach: boolean;
}

export interface CaptureCommitResult {
  categories: number;
  blocks: number;
}
