# Hourly Logger — data schema

The app keeps everything in a single SQLite database at:

    ~/Library/Application Support/HourlyLogger/data.db

The schema below is the **on-disk form**; the JSON export described later is the **portable form** intended for backups, migrations across machines, or rebuilding the app from scratch.

## SQLite tables

### `schema_version`

| column  | type    | notes                   |
| ------- | ------- | ----------------------- |
| version | INTEGER | Single row. Currently 8.|

### `categories`

| column              | type    | notes                                                      |
| ------------------- | ------- | ---------------------------------------------------------- |
| id                  | INTEGER | Primary key, autoincrement.                                |
| name                | TEXT    | Unique, non-null.                                          |
| color               | TEXT    | 6-digit hex like `#A89F8A`.                                |
| archived            | INTEGER | 0/1. Archived categories are hidden from sidebar+quick-add. |
| weekly_goal_minutes | INTEGER | **Legacy/dead as of v8.** Was the weekly target (v6). Migrated into the `goals` table at v8; no longer read or written. Kept only because migrations are additive (can't drop). |
| daily_goal          | INTEGER | **Legacy/dead as of v8.** Was the daily-habit flag (v6). Migrated into `goals` at v8; no longer read or written. |
| created_at          | TEXT    | ISO 8601 UTC.                                              |

### `blocks`

| column          | type    | notes                                                |
| --------------- | ------- | ---------------------------------------------------- |
| id              | INTEGER | Primary key, autoincrement.                          |
| category_id     | INTEGER | Foreign key → `categories.id`. Not null.             |
| start_at        | TEXT    | ISO 8601 UTC.                                        |
| end_at          | TEXT    | ISO 8601 UTC. Constraint: `end_at > start_at`.       |
| note            | TEXT    | Nullable.                                            |
| kind            | TEXT    | `'plan'` or `'actual'` (v2). Plans don't count toward stats. |
| external_source | TEXT    | Nullable (v3). Sync provenance namespace, e.g. `gcal:<hash>`. |
| external_id     | TEXT    | Nullable (v3). Stable per-instance id from the source. |
| detached        | INTEGER | 0/1 (v3). User edited a synced block; sync leaves it alone. |
| pomodoro        | TEXT    | Nullable JSON (v5). Pomodoro metadata — see below.   |
| created_at      | TEXT    | ISO 8601 UTC.                                        |
| updated_at      | TEXT    | ISO 8601 UTC. Re-stamped on every update.            |

The `pomodoro` column holds one of two JSON shapes:

- On a **plan** block — a launchable planned sequence:
  `{ "workMinutes": 45, "breakMinutes": 5, "reps": 3 }`
- On an **actual** block — provenance stamped on the single continuous
  block a finished live pomodoro sequence writes (breaks are *inside*
  the block and count as the category's time):
  `{ "source": "pomodoro", "repsCompleted": 3, "workMinutes": 45, "breakMinutes": 5 }`

Malformed JSON in the column is treated as `null` (the block just loses
its pomodoro affordances).

Indexes:

- `idx_blocks_start` on `blocks(start_at)`
- `idx_blocks_category` on `blocks(category_id)`

Pragmas: `journal_mode = WAL`, `foreign_keys = ON`.

The DB does **not** enforce non-overlap of blocks — life has overlapping
activities. The UI shows overlapping blocks side-by-side with a small dot in
the corner as a visual warning, but it won't block creation.

### `days` (v7)

One row per reflected-on calendar day — how the day felt, and an optional
short journal note. Independent of blocks: the day, not the block, is the
unit for "how it felt". A row with neither an energy nor a journal is
deleted rather than kept blank.

| column     | type | notes                                                              |
| ---------- | ---- | ------------------------------------------------------------------ |
| date       | TEXT | Primary key. Local calendar day, `YYYY-MM-DD`.                     |
| energy     | TEXT | Nullable. One of `flow` / `calm` / `fine` / `drained` / `stressed`. |
| journal    | TEXT | Nullable. A short (1–3 sentence) free-text note.                   |
| created_at | TEXT | ISO 8601 UTC.                                                      |
| updated_at | TEXT | ISO 8601 UTC. Re-stamped on every update.                         |

The five `energy` values model a 2-axis affect grid (activation ×
pleasantness); they're picked from presets in the UI, never inferred.

### `goals` (v8)

Goals moved off the `categories` columns into their own effective-dated
table. Each row is one *revision* of a goal: it applies to local days in
`[effective_from, retired_from)`, and `retired_from IS NULL` means active.
Changing a target retires the active row (`retired_from` = today) and
inserts a fresh one (`effective_from` = today), so history views can score
past weeks against the target that applied then. If the active revision was
already created today, it's edited in place instead — no zero-length
revision is ever left behind. The write API enforces **at most one active
`weekly_minutes` goal and one active habit-kind goal** (`daily_habit` OR
`weekly_frequency`) per category; the schema does not.

| column         | type    | notes                                                                 |
| -------------- | ------- | --------------------------------------------------------------------- |
| id             | INTEGER | Primary key, autoincrement.                                           |
| category_id    | INTEGER | Foreign key → `categories.id`. Not null.                              |
| kind           | TEXT    | `'weekly_minutes'`, `'daily_habit'`, or `'weekly_frequency'`.         |
| target         | INTEGER | Minutes/week (`weekly_minutes`), always 1 (`daily_habit`), or days/week 1–6 (`weekly_frequency`). |
| effective_from | TEXT    | Local `YYYY-MM-DD` the revision starts applying (inclusive).          |
| retired_from   | TEXT    | Nullable. Local `YYYY-MM-DD` the revision stops applying (exclusive); NULL = active. |
| created_at     | TEXT    | ISO 8601 UTC.                                                         |

### `goal_exemptions` (v8)

Marks a single day exempt for a category's habit so it doesn't break a
streak (e.g. a rest day for a "5×/week" goal). Keyed by **category** (not
goal id) so exemptions survive goal revisions.

| column      | type | notes                                                    |
| ----------- | ---- | -------------------------------------------------------- |
| category_id | INTEGER | Foreign key → `categories.id`. Not null. Part of PK.  |
| date        | TEXT | Local `YYYY-MM-DD`. Part of PK.                           |

Habit progress (streaks, done-today, the 14-day strip, weekly-frequency
counts) is computed from `blocks` + these exemptions at render time, never
stored.

## Settings

Settings live in a separate JSON file (so the export contract stays
data-only):

    ~/Library/Application Support/HourlyLogger/settings.json

```jsonc
{
  "dayStartHour": 6,        // 0..23
  "dayEndHour": 24,         // 1..24, exclusive upper bound of the timeline
  "theme": "system",        // "system" | "light" | "dark"
  "showArchived": false,    // show archived categories in sidebar?
  // Pomodoro defaults — seed the start popover / plan editor. Per-session
  // values are copied into the active session at start.
  "pomodoroWorkMinutes": 25,
  "pomodoroBreakMinutes": 5,
  "pomodoroLongBreakMinutes": 15,
  "pomodorosPerCycle": 4
  // (plus gcal* calendar-sync keys, omitted here)
}
```

Defaults are written on first launch and validated with zod on every read.

## Other app-state files

Two more JSON files live alongside `settings.json`. Like settings, they are
app-state — **not** part of the export contract, and safe to delete (they're
rebuilt as needed):

- `aliases.json` — learned quick-capture aliases: a flat map of normalized
  phrase → category id, e.g. `{ "standup": 3, "macey": 1 }`. Written when you
  assign a category to a phrase in the capture review. A malformed file is
  treated as "no aliases". Aliases whose target category no longer exists are
  ignored at match time.
- `active-session.json` — the live recording (stopwatch or Pomodoro) in
  progress, persisted on every transition so a crash mid-session is
  recoverable on next launch. Absent when nothing is recording.

## JSON export format

This is the **stable, documented** format. It's what backups and the manual
"Export JSON" action produce, and what "Import JSON" consumes. The format is
intended to survive across app versions and machines.

```jsonc
{
  "format": "hourly-logger-export",
  "version": 1,
  "exported_at": "2026-05-21T17:00:00.000Z",
  "categories": [
    {
      "id": 1,
      "name": "Macey work",
      "color": "#A89F8A",
      "archived": false,
      "weekly_goal_minutes": 600,
      "daily_goal": false,
      "created_at": "2026-05-21T10:00:00.000Z"
    }
  ],
  "blocks": [
    {
      "id": 1,
      "category_id": 1,
      "start_at": "2026-05-21T13:00:00.000Z",
      "end_at": "2026-05-21T14:20:00.000Z",
      "note": "Pricing notes",
      "kind": "actual",
      "external_source": null,
      "external_id": null,
      "detached": false,
      "pomodoro": null,
      "created_at": "2026-05-21T14:21:00.000Z",
      "updated_at": "2026-05-21T14:21:00.000Z"
    }
  ],
  "days": [
    {
      "date": "2026-05-21",
      "energy": "flow",
      "journal": "Long focus morning on pricing; afternoon got scattered.",
      "created_at": "2026-05-21T22:00:00.000Z",
      "updated_at": "2026-05-21T22:00:00.000Z"
    }
  ],
  "goals": [
    {
      "id": 1,
      "category_id": 1,
      "kind": "weekly_minutes",
      "target": 600,
      "effective_from": "1970-01-01",
      "retired_from": null,
      "created_at": "2026-05-21T10:00:00.000Z"
    }
  ],
  "goal_exemptions": [
    { "category_id": 1, "date": "2026-05-24" }
  ]
}
```

Rules:

- `format` must equal `"hourly-logger-export"`.
- `version` is an integer. Imports refuse anything other than `1` for now.
  (The export `version` is the portable-format version — distinct from the
  on-disk `schema_version`, currently 8. New fields are added
  backward-compatibly, so the format version stays 1.)
- All timestamps are ISO 8601, UTC, with millisecond precision.
- `color` is a 6-digit hex string starting with `#`.
- `archived`, `daily_goal`, and `detached` are booleans (not 0/1) in the JSON form.
- `weekly_goal_minutes` and `pomodoro` are nullable; `kind` is `'plan'` or `'actual'`.
- Both archived and active categories are included; archive state is preserved.
- Imports tolerate older exports missing the v2–v7 fields (`kind`,
  `external_*`, `detached`, `pomodoro`, the legacy category goal columns,
  the `days` array) and fill safe defaults.
- `days` is the per-day energy + journal table; `energy` is one of the five
  presets or `null`. A pre-v7 export simply omits `days`.
- `goals` and `goal_exemptions` are the v8 goal tables. `goal_exemptions`
  defaults to `[]` when absent. `goals` is special: when the field is
  **absent entirely** (a pre-v8 export), the importer *synthesizes* goal
  rows from each category's legacy `weekly_goal_minutes` / `daily_goal`
  (same mapping as the v8 migration, `effective_from` `1970-01-01`). An
  explicit `goals` array — even an empty one — is used verbatim, so a v8+
  export with no goals imports as no goals rather than re-synthesizing from
  the dead columns.

Importing **replaces** the current database in a single transaction. There is
no merge — this matches the "restore from backup" intent for a single-user
tool. The UI confirms once before doing it.

## CSV export

Separate `categories.csv`, `blocks.csv`, `days.csv`, `goals.csv`, and
`goal_exemptions.csv` files inside a single zip. Columns match the SQLite
column names verbatim. UTF-8, comma-separated, RFC-4180-style quoting (only
when needed).

## Automatic backups

On every app launch, if no backup file exists newer than 24 hours, a fresh JSON
snapshot is written to:

    ~/Library/Application Support/HourlyLogger/backups/backup-YYYY-MM-DD-HHmm.json

The newest 30 backup files are kept; older ones are deleted silently.

## Migrations

Schema changes will bump the `schema_version` row. The main process applies
migrations in order at startup, inside a transaction. Each migration takes the
database from version N to N+1, never further.

If a JSON export from a newer schema version is opened by an older app build,
the import refuses with a clear message instead of attempting a partial load.
