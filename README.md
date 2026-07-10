# Hourly Logger

A small, restrained macOS app for logging how you spend your time, hour by
hour. It started as a retroactive time logger and has grown into a calm daily
companion: a two-lane **Plan / Actual** timeline, a built-in **Pomodoro**
sequence runner, read-only **calendar (ICS) sync**, lightweight **goals &
streaks**, and a **natural-language quick capture** bar — all local-first,
with first-class JSON / CSV export and automatic daily backups.

Built with Electron + React + TypeScript + Tailwind. SQLite via
`better-sqlite3`. macOS only (Apple Silicon `.dmg`).

## What it does

- **Day view — two lanes.** A vertical timeline split into a **Plan** lane
  (what you intend) and an **Actual** lane (what happened). Click-drag on
  empty space to create a block in either lane; click a block to edit it.
  A "Done" chip (or the `D` key) mirrors a finished plan block into Actual,
  and a toolbar button bulk-mirrors all eligible plan blocks.
- **Quick capture.** Press `N`, type how a stretch of the day went in plain
  English ("9-11 deep work, lunch, 1-4 interviews"), review the parsed
  blocks, and commit. Fully local and deterministic — no network, no model.
  It learns phrase→category aliases as you go.
- **Live recording & Pomodoro.** Start a stopwatch recording, or a Pomodoro
  sequence (work → full-screen break covers → next rep), which writes one
  continuous Actual block when finished. A hold-to-peek pill
  (`Ctrl+Option+P`) shows the live countdown on every display.
- **Week view.** A 7-day grid (Mon–Sun) of your actual blocks, each day
  topped with an energy band — a calm "how has my week felt?" glance. Click
  a day to drill into it.
- **Day reflection.** Tap how a day felt — **Flow / Calm / Fine / Drained /
  Stressed** — and optionally jot a line or two. It's real, exported data,
  and it's what colors the Week view's texture.
- **Aggregate view.** Date-range presets + a per-category stacked bar and a
  sortable totals table (total / sessions / avg / longest).
- **Goals.** Optional per-category weekly-hour targets and habit streaks —
  either every-day or N-days-per-week — with per-day "excused" days that
  don't break a streak. All computed from your blocks (never stored), and
  effective-dated so past weeks score against the target that applied then.
- **Calendar sync.** Point it at one or more private iCal URLs; events sync
  in as Plan blocks under a "From calendar" category.
- **Export / import / backup.** Stable JSON (and CSV-zip) export, replace-all
  JSON import, and silent daily JSON backups (last 30 kept).

## Running in development

```sh
npm install --ignore-scripts
node node_modules/electron/install.js
npx electron-builder install-app-deps   # rebuilds native modules against Electron's Node ABI
npm run dev
```

The `--ignore-scripts` step works around the fact that `better-sqlite3` will
attempt to compile against your *system* Node on `npm install`, which fails on
Node 25+. We then download Electron's runtime and let
`@electron/rebuild` rebuild the native binding against Electron's bundled
Node 20 instead. Once those two manual steps have been run once, normal `npm`
operations behave normally.

If you ever switch Node versions or upgrade Electron, run `npm run rebuild`
(which is just `electron-builder install-app-deps`) to re-rebuild
native modules.

Run the parser unit tests with `npm test` (Vitest).

## Building the distributable

```sh
npm run build
```

Produces:

- `release/HourlyLogger-1.0.0-arm64.dmg`
- `release/mac-arm64/Hourly Logger.app`

The build is **not** signed or notarised — you'll see Gatekeeper warnings
unless you sign it yourself. To install: open the `.dmg`, drag the app into
Applications. (Unsigned, locally-built: the first launch may need
right-click → Open.)

To just produce an unpacked `.app` without making the `.dmg` (faster):

```sh
npm run build:unpack
```

## Where the data lives

| Thing                 | Path                                                          |
| --------------------- | ------------------------------------------------------------- |
| SQLite database       | `~/Library/Application Support/HourlyLogger/data.db`          |
| Settings              | `~/Library/Application Support/HourlyLogger/settings.json`    |
| Learned capture aliases | `~/Library/Application Support/HourlyLogger/aliases.json`   |
| Active live session   | `~/Library/Application Support/HourlyLogger/active-session.json` |
| Automatic backups     | `~/Library/Application Support/HourlyLogger/backups/`         |

You can reveal the database, backups, and settings from inside the app
(Settings → Paths → click the path). To back the data up, copy `data.db`
somewhere safe. To migrate machines, copy the whole `HourlyLogger` folder or
use Export → JSON. Only `data.db` is user data; the other files are app state
(rebuilt as needed) and are intentionally outside the export contract.

## Keyboard shortcuts

| Key            | Action                                                |
| -------------- | ----------------------------------------------------- |
| `N`            | Open quick capture                                    |
| `←` / `→`      | Previous / next day (Day) or week (Week)              |
| `T`            | Jump to today / this week                             |
| `1` / `2` / `3`| Switch to Day / Week / Aggregate view                 |
| `D`            | Mark a focused, ended Plan block as Done (mirror it)  |
| `Esc`          | Close any open popover / editor                       |
| `⌘E`           | Export current data as JSON                           |
| `⌘,`           | Open settings                                         |
| `?`            | Show shortcut overlay                                 |
| `⌘↵`           | Add the parsed blocks (in quick capture)              |
| `1`–`9`        | Pick the Nth filtered result in a category combobox   |
| `Ctrl+Option+P`| Hold to peek the live Pomodoro countdown (overlay)    |
| `Alt + drag`   | 1-minute snap when dragging on timeline (default 5m)  |

## Quick capture

Press `N` (or the **Capture** button in the day toolbar). Type a free-text
description of how a stretch of the day went — one line or many. A
deterministic rules parser turns it into block drafts you review and edit
before committing; nothing is written until you click **Add**.

- Understands time forms like `9`, `9:30am`, `21:00`, `1-4`, `till noon`,
  `9.30`, and durations like `30m` / `2h`. An ambiguous range resolves to
  the **shortest same-day span** — `11-2pm` is 11am–2pm, not 11am–2am;
  `1-4` is 1pm–4pm. Explicit am/pm and 24-hour times are always respected.
- A leading **`from last event`** anchors the start to the end of your most
  recent logged (actual) block — handy when logging from the phone without
  the timeline in view: `from last event till now Ammamma Walk` (also
  `since`/`after`, `previous event`, and `… for 90m`). Phone logs sent
  together chain off each other.
- Activities are separated by commas, new lines, or sequence words
  (`then`, `after that`, `next`), which are treated as filler — not part of
  the description.
- Each phrase is fuzzy-matched to an **existing** category. Anything it
  can't match is left **unassigned** — you pick a category (or create one
  with "+ new") in the review, and nothing commits until you do. That choice
  is then **remembered** (an alias) and auto-fills the next time you type the
  same phrase (shown with a "remembered" hint).
- Toggle the whole capture between **Actual** and **Plan**, and choose the
  day it logs to.

See `SCHEMA.md` for the parser's grammar boundaries (it surfaces anything it
can't read as "Couldn't read…" rather than guessing).

## Pomodoro

Start a session from the day toolbar's **Start session** control and enable
Pomodoro mode (work / break / long-break minutes are configurable in
Settings → Pomodoro). Work phases run a drift-corrected countdown; breaks
show a full-screen cover on every display with skip / "+N min" / finish
controls; an "awaiting" prompt appears between reps. Finishing writes one
continuous Actual block (breaks included — they count as the category's
time). A crash mid-sequence is recoverable on next launch.

## Calendar sync

Settings → Calendar sync. Paste one or more private iCal URLs (Google
Calendar → *Settings & sharing → Secret address in iCal format*). Events in a
−1d…+7d window sync in as **Plan** blocks under an auto-created "From
calendar" category, on an interval you set (≥5 min). Editing a synced block
detaches it so sync leaves it alone thereafter; removing a URL removes its
(non-detached) blocks.

## Export and import

Three things are available under Settings → Data:

- **Export JSON** — single file, complete snapshot. Stable schema (see
  `SCHEMA.md`). Use this for backups and machine migrations.
- **Export CSV (zip)** — two CSV files (`categories.csv`, `blocks.csv`) in
  one zip. Convenient for spreadsheet analysis.
- **Import JSON** — replace-all import. Asks for confirmation showing a
  preview of what would be replaced. Strictly checks `format` and `version`;
  refuses gracefully if either doesn't match.

Automatic JSON backups run silently on launch if the newest backup is more
than 24 hours old. The newest 30 are kept.

## Schema

See `SCHEMA.md` for the SQLite table layout (currently schema version 7) and
the JSON export format.

## Design notes & judgment calls

A few things weren't fully specified; the choices made:

- **Settings, aliases, and the active session are JSON files, not SQLite
  tables.** They're app-state, not user-data; keeping them separate keeps the
  export contract clean (only `data.db` round-trips through export/import).
- **Replace-all import semantics.** Merging by ID across exports is a footgun
  for a single-user tool. "Restore from backup" is the obvious intent. The UI
  confirms before wiping current data.
- **Plan vs Actual is a lane, captured once.** The block editor never lets
  you flip a block's lane (avoids accidental misclassification); only stats
  read Actual blocks — Plan blocks never count toward totals/goals.
- **Goals are computed, never stored.** Weekly progress and habit streaks are
  derived from blocks (plus per-day exemptions) at render time. The goal
  *definitions* live in an effective-dated `goals` table (schema v8), so a
  target change retires the old revision and history stays scoreable.
- **Day energy is per-day, from presets — no ML.** How a day felt is your
  own read, captured in one tap from five presets (a 2-axis affect model:
  energy × pleasantness), never inferred. All reflection is plain
  aggregation; nothing leaves the machine. Per-day (not per-block) keeps
  tagging frictionless.
- **Default theme = follow OS.** A toggle in Settings overrides to
  light/dark explicitly.
- **electron-vite over hand-rolled Vite + Electron.** Cleaner main /
  preload / renderer separation, less config to maintain.
- **Each auxiliary window gets its own minimal preload.** The break covers
  and peek overlay can act on the running Pomodoro but can't touch the
  database or settings.
- **Break covers keep the app a regular app.** `setVisibleOnAllWorkspaces`
  defaults to transforming the whole process into a macOS *accessory*
  (UIElement) app, which silently removes Hourly Logger from the Dock's
  running indicator and the Cmd-Tab switcher. We pass
  `skipTransformProcessType: true` so the cover still shows over full-screen
  apps (via the FullScreenAuxiliary collection behavior + screen-saver window
  level) without demoting the app.
- **Inline confirms, not modals,** for destructive actions (block delete,
  category archive when it has history, calendar disconnect) per the spec's
  tone.

## Project structure

```
hourly-logger/
  electron.vite.config.ts
  vitest.config.ts
  tailwind.config.ts
  electron-builder.yml
  resources/
    icon.svg / icon.icns / icon.png   # app icon (source + generated)
  scripts/
    build-icon.mjs                     # SVG → icns + PNG
    smoke-db.mjs
  src/
    main/                     # Electron main process
      index.ts                # window, lifecycle, IPC registration, backups, sleep-pause
      db.ts                   # better-sqlite3, schema migrations, CRUD
      ipc.ts                  # typed handlers + zod validation
      settings.ts             # settings.json read/write with defaults
      paths.ts                # ~/Library/Application Support/HourlyLogger/*
      backup.ts               # daily JSON snapshot + rotation
      capture.ts              # transactional commit of quick-capture drafts
      aliases.ts              # learned phrase→category aliases (aliases.json)
      activeSession.ts        # live-recording JSON file (crash recovery)
      calendarSync.ts         # ICS polling + reconcile into Plan blocks
      notifications.ts        # silent pomodoro notifications
      windows.ts              # main-window registry (avoids an import cycle)
      coverWindows.ts         # full-screen break covers (one per display)
      overlayWindow.ts        # hold-to-peek pill (one per display)
      holdToPeek.ts           # Ctrl+Option+P global shortcut
      pomodoro/
        engine.ts             # the work/break/awaiting state machine
        timer.ts              # drift-corrected countdown
    preload/
      index.ts                # contextBridge: window.api (full surface)
      cover.ts                # window.coverApi (break covers, narrow)
      overlay.ts              # window.overlayApi (peek pill, read-only)
    renderer/                 # React app
      index.html / cover.html / overlay.html
      App.tsx / main.tsx
      components/
        Sidebar / CategoryRow / CategoryCombobox / ColorPicker / NewCategoryDialog
        Timeline / TimelineBlock / BlockEditor / DayToolbar
        SessionStartPopover / RecordingEditor / SessionRecoveryDialog / pomodoroUi
        GoalsPanel / SettingsPanel / ShortcutsOverlay
        CaptureModal           # quick-capture review UI
      cover/CoverApp.tsx       # break-cover renderer
      overlay/OverlayApp.tsx   # peek-pill renderer
      views/
        DayView.tsx / WeekView.tsx / AggregateView.tsx
      lib/
        api.ts                # typed view of window.api
        time.ts               # parseTimeInput("9pm"), formatting helpers
        colors.ts             # curated palette + withAlpha
        aggregate.ts          # per-category totals & session stats
        goals.ts              # weekly progress & habit streaks
        plan.ts               # Done-eligibility / matches-plan predicates
        shortcuts.ts          # useGlobalShortcuts hook
        capture/
          segment.ts          # split free text into activity segments
          clock.ts            # parse a clock token (PM heuristic, keywords)
          match.ts            # fuzzy category + alias matching
          parse.ts            # orchestrates text → block drafts
          parse.test.ts       # parser unit tests (Vitest)
      styles/
        index.css             # Tailwind layers + CSS variables for theme
    shared/
      types.ts                # types shared between main + renderer
      schema.ts               # zod schemas for the IPC boundary + import
  SCHEMA.md
  README.md
```

## Scripts

| Script                 | What it does                                  |
| ---------------------- | --------------------------------------------- |
| `npm run dev`          | Hot-reloading dev electron app                |
| `npm run build`        | Build all bundles and produce a `.dmg`        |
| `npm run build:unpack` | Build but skip DMG creation (faster)          |
| `npm run typecheck`    | Run `tsc --noEmit` for both halves            |
| `npm test`             | Run the capture parser unit tests (Vitest)    |
| `npm run icon`         | Regenerate `icon.icns` from `icon.svg`        |
| `npm run rebuild`      | Rebuild native modules against Electron's Node |
