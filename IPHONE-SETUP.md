# Logging from your iPhone

Log activities from your phone and have them appear automatically on the
Hourly Logger timeline on your Mac. It's free, works offline, and needs no
account or server — entries ride across on **iCloud Drive**.

## How it works

1. An **Apple Shortcut** on your iPhone writes one tiny JSON file per
   entry into `iCloud Drive / HourlyLogger / inbox/`.
2. iCloud syncs that file to your Mac (over Wi‑Fi **or** cellular).
3. Hourly Logger watches the folder and imports each entry as an **Actual**
   block — parsing any times you include, and routing anything it can't
   match to a **"Phone log"** category you can re-file later.

Entries logged while the Mac app is closed simply wait in the folder and
import the next time you open it. Latency is iCloud's pace — usually
seconds to about a minute.

> The Mac creates the `HourlyLogger/inbox/` folder automatically on first
> launch (as long as iCloud Drive is enabled). You can also create it by
> hand in the Files app / Finder.

## Build the Shortcut (about 3 minutes)

Open the **Shortcuts** app on your iPhone → **+** to create a new shortcut,
and add these actions in order:

1. **Ask for Input**
   - Input Type: **Text**
   - Prompt: e.g. `Log what?`
   - (For voice instead of typing, use **Dictate Text** here.)

2. **Date** → gives you the current date/time.

3. **Format Date**
   - Date: the **Date** from step 2
   - Format: **ISO 8601** (make sure it includes the time)
   - This becomes your `Formatted Date`.

4. **Dictionary** — add two keys:
   | Key    | Type | Value |
   |--------|------|-------|
   | `text` | Text | the **Provided Input** from step 1 |
   | `ts`   | Text | the **Formatted Date** from step 3 |

5. **Number** → **Random Number** (e.g. min `100000`, max `999999`) — just
   to keep filenames unique. Call it `Random`.

6. **Save File**
   - File: the **Dictionary** from step 4
   - Service / Destination: **iCloud Drive**
   - **Ask Where to Save: OFF**
   - **Overwrite If File Exists: OFF**
   - Destination path / name:
     `HourlyLogger/inbox/[Formatted Date]-[Random].json`
     (insert the `Formatted Date` and `Random` variables; the `.json`
     extension matters)

Name the shortcut something short like **Log** and save.

### Make it frictionless

- **Add to Home Screen** — Shortcut details → *Add to Home Screen*. One tap → type/speak → done.
- **Siri** — just say "Hey Siri, **Log**". Siri will ask "Log what?" and you dictate.
- **Action Button / Back Tap / Lock Screen widget** can all trigger it too.

## The file format

Each file is a single JSON object. `text` is required; `ts` is optional
(if you omit it, the file's modification time is used):

```json
{ "text": "deep work on pricing", "ts": "2026-06-22T15:30:00-07:00" }
```

### What you can write in `text`

It runs through the same natural-language parser as the in-app quick
capture, with "now" set to when you logged it:

- `lunch` → a 30‑minute block starting now (the default duration — change
  it in the app's settings via `phoneInboxDefaultMinutes`).
- `deep work 2-3pm`, `standup at 10 for 30m`, `emails till noon` → the
  times you give are honored.
- `gym then errands` → multiple blocks, chained like in quick capture.

Anything the parser can't match to one of your categories goes into the
auto‑created **"Phone log"** category so nothing is lost — recategorize it
on the Mac whenever.

## Notes & limits

- **Same device, no Mac required to be on Wi‑Fi specifically** — iCloud
  moves files over any connection. The Mac just needs to be running (and
  the app opened at some point) to import them.
- **Duplicates:** each entry is its own uniquely-named file, so it imports
  exactly once. Imported files are moved to `HourlyLogger/processed/`;
  unreadable ones go to `HourlyLogger/failed/`.
- **Privacy:** everything stays in your own iCloud and your local
  database. No third‑party services.
- Turn the whole thing off (or point it at a different folder) via the
  `phoneInboxEnabled` / `phoneInboxFolderPath` settings.
