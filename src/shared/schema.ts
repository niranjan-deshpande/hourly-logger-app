import { z } from 'zod';

export const hexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Color must be a 6-digit hex like #A89F8A');

export const categoryCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  color: hexColor,
});

export const categoryUpdateSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().trim().min(1).max(80).optional(),
  color: hexColor.optional(),
  archived: z.boolean().optional(),
});

// --- Goals (v8) ---
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// A weekly minutes target: 1–10080 (one week). null clears it.
export const goalSetWeeklySchema = z.object({
  categoryId: z.number().int().positive(),
  minutes: z.number().int().min(1).max(10080).nullable(),
});

// The habit goal: null (off), an every-day habit, or an N-days-per-week
// habit (1–6). Replaces whichever habit-kind goal is active.
export const goalSetHabitSchema = z.object({
  categoryId: z.number().int().positive(),
  habit: z
    .union([
      z.object({ kind: z.literal('daily_habit') }),
      z.object({
        kind: z.literal('weekly_frequency'),
        target: z.number().int().min(1).max(6),
      }),
    ])
    .nullable(),
});

export const goalListExemptionsSchema = z.object({
  from: ymd,
  to: ymd,
});

export const goalSetExemptionSchema = z.object({
  categoryId: z.number().int().positive(),
  date: ymd,
  excused: z.boolean(),
});

export const blockKindSchema = z.enum(['plan', 'actual']);

// Stored in blocks.pomodoro (nullable JSON TEXT column, schema v5). Two
// shapes: plan meta (a planned sequence in the Plan lane, launchable into
// a live session) and actual meta (provenance + rep count stamped on the
// single continuous block a finished live sequence writes). The union is
// unambiguous: plan meta has `reps` and no `source`; actual meta has
// `source` and no `reps`.
export const pomodoroPlanMetaSchema = z.object({
  workMinutes: z.number().int().min(1).max(180),
  breakMinutes: z.number().int().min(1).max(60),
  reps: z.number().int().min(1).max(20),
});

export const pomodoroActualMetaSchema = z.object({
  source: z.literal('pomodoro'),
  repsCompleted: z.number().int().min(0),
  workMinutes: z.number().int().min(1).max(180),
  breakMinutes: z.number().int().min(1).max(60),
});

export const blockPomodoroSchema = z.union([
  pomodoroActualMetaSchema,
  pomodoroPlanMetaSchema,
]);

export const blockCreateSchema = z
  .object({
    categoryId: z.number().int().positive(),
    startAt: z.string().datetime({ offset: true }),
    endAt: z.string().datetime({ offset: true }),
    note: z.string().nullable().optional(),
    // Default to 'actual' so existing callers (recording flow, recovery
    // dialog, prior code paths) don't have to change.
    kind: blockKindSchema.optional(),
    pomodoro: blockPomodoroSchema.nullable().optional(),
  })
  .refine((b) => new Date(b.endAt) > new Date(b.startAt), {
    message: 'end_at must be after start_at',
    path: ['endAt'],
  });

export const blockUpdateSchema = z
  .object({
    id: z.number().int().positive(),
    categoryId: z.number().int().positive().optional(),
    startAt: z.string().datetime({ offset: true }).optional(),
    endAt: z.string().datetime({ offset: true }).optional(),
    note: z.string().nullable().optional(),
    kind: blockKindSchema.optional(),
    // detached is updatable from the renderer so the BlockEditor can
    // mark a synced block as detached when the user edits it. There's
    // no path for clearing it (detach is one-way).
    detached: z.boolean().optional(),
    // Nullable so the BlockEditor can remove a sequence from a plan
    // block (null clears it; undefined leaves it untouched).
    pomodoro: blockPomodoroSchema.nullable().optional(),
  })
  .refine(
    (b) => {
      if (b.startAt && b.endAt) return new Date(b.endAt) > new Date(b.startAt);
      return true;
    },
    { message: 'end_at must be after start_at', path: ['endAt'] }
  );

export const categoryRowSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  color: hexColor,
  archived: z.boolean(),
  // Pre-v6 exports won't include these; default to "no goals".
  weekly_goal_minutes: z.number().int().min(1).max(10080).nullable().default(null),
  daily_goal: z.boolean().default(false),
  created_at: z.string(),
});

export const blockRowSchema = z.object({
  id: z.number().int().positive(),
  category_id: z.number().int().positive(),
  start_at: z.string(),
  end_at: z.string(),
  note: z.string().nullable(),
  // Optional with default so pre-v2 exports (no kind field at all) still
  // validate and silently round-trip as actuals. New exports always emit
  // an explicit value.
  kind: blockKindSchema.default('actual'),
  // Same backward-compat trick for the v3 sync columns — pre-v3
  // exports won't include these.
  external_source: z.string().nullable().default(null),
  external_id: z.string().nullable().default(null),
  detached: z.boolean().default(false),
  // Pre-v5 exports won't include this; default to "no pomodoro meta".
  pomodoro: blockPomodoroSchema.nullable().default(null),
  created_at: z.string(),
  updated_at: z.string(),
});

// --- Per-day energy & journal (v7) ---

export const dayEnergySchema = z.enum([
  'flow',
  'calm',
  'fine',
  'drained',
  'stressed',
]);

export const dayRecordSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  // Pre-v7 exports won't have these; default to empty.
  energy: dayEnergySchema.nullable().default(null),
  journal: z.string().nullable().default(null),
  created_at: z.string(),
  updated_at: z.string(),
});

// undefined leaves a field untouched; null clears it.
export const dayUpsertSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  energy: dayEnergySchema.nullable().optional(),
  journal: z.string().max(2000).nullable().optional(),
});

// --- Goal export rows (v8) ---

export const goalRowSchema = z.object({
  id: z.number().int().positive(),
  category_id: z.number().int().positive(),
  kind: z.enum(['weekly_minutes', 'daily_habit', 'weekly_frequency']),
  target: z.number().int(),
  effective_from: z.string(),
  retired_from: z.string().nullable().default(null),
  created_at: z.string(),
});

export const goalExemptionRowSchema = z.object({
  category_id: z.number().int().positive(),
  date: ymd,
});

export const exportV1Schema = z.object({
  format: z.literal('hourly-logger-export'),
  version: z.literal(1),
  exported_at: z.string(),
  categories: z.array(categoryRowSchema),
  blocks: z.array(blockRowSchema),
  // Pre-v7 exports won't include this; default to no day records.
  days: z.array(dayRecordSchema).default([]),
  // Goals (v8). Deliberately `.optional()` (not `.default([])`):
  // `undefined` means "pre-v8 export" and the importer synthesizes goal
  // rows from each category's legacy weekly_goal_minutes/daily_goal. An
  // explicit (possibly empty) array is used verbatim.
  goals: z.array(goalRowSchema).optional(),
  goal_exemptions: z.array(goalExemptionRowSchema).default([]),
});

export const appSettingsSchema = z.object({
  dayStartHour: z.number().int().min(0).max(23),
  dayEndHour: z.number().int().min(1).max(24),
  theme: z.enum(['light', 'dark', 'system']),
  showArchived: z.boolean(),
  // Calendar sync. Empty array means "not configured". Each URL must
  // be a syntactically valid http(s) URL; min interval of 5 avoids
  // hammering endpoints. We restrict to http(s) here because the
  // sync engine uses `fetch()` which only handles those schemes —
  // an ftp:// or file:// URL would silently fail at sync time.
  gcalIcsUrls: z
    .array(
      z
        .string()
        .url()
        .refine(
          (u) => {
            try {
              const proto = new URL(u).protocol;
              return proto === 'http:' || proto === 'https:';
            } catch {
              return false;
            }
          },
          { message: 'URL must start with http:// or https://' }
        )
    )
    .default([]),
  gcalSyncIntervalMinutes: z.number().int().min(5).max(720).default(15),
  gcalCategoryId: z.number().int().positive().nullable().default(null),
  gcalLastSyncAt: z.string().nullable().default(null),
  gcalLastSyncError: z.string().nullable().default(null),
  // Pomodoro defaults. These seed the start popover and the plan-block
  // sequence editor; the per-session values live in the active session
  // (and plan meta), so changing these never affects a running sequence.
  pomodoroWorkMinutes: z.number().int().min(1).max(180).default(25),
  pomodoroBreakMinutes: z.number().int().min(1).max(60).default(5),
  pomodoroLongBreakMinutes: z.number().int().min(1).max(60).default(15),
  pomodorosPerCycle: z.number().int().min(1).max(12).default(4),
  // Phone inbox. All defaulted so a settings.json written before this
  // feature existed still parses and picks up sane values.
  phoneInboxEnabled: z.boolean().default(true),
  phoneInboxFolderPath: z.string().default(''),
  phoneInboxCategoryId: z.number().int().positive().nullable().default(null),
  phoneInboxDefaultMinutes: z.number().int().min(1).max(1440).default(30),
  phoneInboxLastImportAt: z.string().nullable().default(null),
  phoneInboxLastError: z.string().nullable().default(null),
});

// A file dropped by the iOS Shortcut into the inbox folder. Lenient on
// purpose: `text` is the only hard requirement; a missing/!string `ts`
// becomes null and the reader falls back to the file's mtime. Anything
// that fails this is moved aside to the failed/ folder, never imported.
export const phoneInboxFileSchema = z.object({
  text: z.string().trim().min(1).max(2000),
  ts: z.string().min(1).nullable().optional(),
});

export const pomodoroPhaseSchema = z.enum(['work', 'break', 'awaiting']);

// Pomodoro machine state, persisted inside the active-session file on
// every transition (never per tick — phaseEndsAt is wall-clock, so
// recovery after a crash is computable from the file alone).
export const activeSessionPomodoroSchema = z.object({
  workMinutes: z.number().int().min(1).max(180),
  breakMinutes: z.number().int().min(1).max(60),
  longBreakMinutes: z.number().int().min(1).max(60),
  pomodorosPerCycle: z.number().int().min(1).max(12),
  // 'awaiting' = a break ended and no timer is running; the user hasn't
  // started the next rep or finished yet.
  phase: pomodoroPhaseSchema,
  phaseEndsAt: z.string().datetime({ offset: true }).nullable(),
  isPaused: z.boolean(),
  pausedRemainingSeconds: z.number().int().min(0).nullable(),
  repsCompleted: z.number().int().min(0),
  // Stamped at every work/break completion. When the session is finished
  // from 'awaiting', the block ends here — not at "now" (walk-away rule).
  lastPhaseEndAt: z.string().datetime({ offset: true }).nullable(),
  isExtension: z.boolean(),
  planBlockId: z.number().int().positive().nullable(),
  // One-shot overrides for the NEXT focus/break phase. Consumed (and
  // cleared) when that phase starts; the session params chosen at start
  // remain the defaults for every phase after. Defaults so session
  // files written by older builds still parse.
  nextWorkMinutes: z.number().int().min(1).max(180).nullable().default(null),
  nextBreakMinutes: z.number().int().min(1).max(60).nullable().default(null),
});

// Persisted active-session record. Validated on every read so a corrupt
// file is treated as "no session" rather than crashing the app.
// `pomodoro` is optional: plain stopwatch recordings never write it, and
// session files from older builds still parse.
export const activeSessionSchema = z.object({
  startAt: z.string().datetime({ offset: true }),
  categoryId: z.number().int().positive(),
  note: z.string().nullable(),
  pomodoro: activeSessionPomodoroSchema.optional(),
});

export const activeSessionStartSchema = z.object({
  categoryId: z.number().int().positive(),
  note: z.string().nullable().optional(),
});

export const activeSessionUpdateSchema = z.object({
  categoryId: z.number().int().positive().optional(),
  note: z.string().nullable().optional(),
});

export const pomodoroStartSchema = z.object({
  categoryId: z.number().int().positive(),
  note: z.string().nullable().optional(),
  workMinutes: z.number().int().min(1).max(180),
  breakMinutes: z.number().int().min(1).max(60),
  longBreakMinutes: z.number().int().min(1).max(60),
  pomodorosPerCycle: z.number().int().min(1).max(12),
  planBlockId: z.number().int().positive().nullable().optional(),
});

export const pomodoroExtendSchema = z.object({
  minutes: z.number().int().min(1).max(60),
});

// Mid-sequence adjustments: set/clear the one-shot next-phase overrides.
// undefined = leave untouched; null = clear back to the session default.
export const pomodoroNextOverridesSchema = z.object({
  workMinutes: z.number().int().min(1).max(180).nullable().optional(),
  breakMinutes: z.number().int().min(1).max(60).nullable().optional(),
});

export const pomodoroStartNextRepSchema = z.object({
  // Optional one-shot length for the rep being started right now.
  workMinutes: z.number().int().min(1).max(180).optional(),
});

// --- Quick capture ---

// A single reviewed draft sent to capture.commit. Validated to ensure
// end > start and that EXACTLY ONE of categoryId / newCategory is set
// (the block FK requires a resolvable category).
export const commitDraftSchema = z
  .object({
    startAt: z.string().datetime({ offset: true }),
    endAt: z.string().datetime({ offset: true }),
    categoryId: z.number().int().positive().nullable(),
    newCategory: z
      .object({ name: z.string().trim().min(1).max(80), color: hexColor })
      .nullable(),
    note: z.string().nullable(),
    kind: blockKindSchema,
    rawPhrase: z.string(),
    teach: z.boolean(),
  })
  .refine((d) => new Date(d.endAt) > new Date(d.startAt), {
    message: 'end_at must be after start_at',
    path: ['endAt'],
  })
  .refine((d) => (d.categoryId == null) !== (d.newCategory == null), {
    message: 'exactly one of categoryId / newCategory must be set',
    path: ['categoryId'],
  });

export const captureCommitSchema = z.object({
  drafts: z.array(commitDraftSchema).min(1),
});

// Persisted alias file: a flat map of normalized phrase → category id.
export const aliasFileSchema = z.record(
  z.string(),
  z.number().int().positive()
);

// --- Phone inbox ---

// Ids (file basenames) the renderer reports as durably committed.
export const phoneInboxMarkProcessedSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
});
