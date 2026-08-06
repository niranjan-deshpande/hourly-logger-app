# Logging from your iPhone

Log activities from your phone and have them appear automatically on the
Hourly Logger timeline on your Mac. There are two transports; both are
free and both feed the same import pipeline (entries parse through the
quick-capture grammar and land as **Actual** blocks):

| | **Phone relay** (recommended) | **iCloud inbox** (legacy) |
|---|---|---|
| Phone side | A home-screen web app you control | A hand-built iOS Shortcut |
| Presets | Your categories + remembered phrases as tappable chips | None |
| Voice | Keyboard dictation + in-page mic button | Siri / Dictate Text |
| Transport | Private Cloudflare Worker (free tier) | iCloud Drive file sync |
| Latency | Seconds (Mac polls every 30 s) | iCloud's pace (seconds–minutes) |
| Third parties | Cloudflare (your own account) | None |

Both can be on at once; they don't interfere.

## Phone relay (the web-app path)

### How it works

1. A tiny **Cloudflare Worker** (in `phone-relay/`, deployed to your own
   free Cloudflare account) serves a phone-sized web page and a private
   JSON mailbox backed by a **D1** database. Everything requires a shared
   secret token.
2. You open the page on your iPhone, **Add to Home Screen**, and it
   behaves like an app: type or dictate an entry, or tap a preset chip —
   it POSTs one `{ id, text, ts }` entry to the mailbox. Offline? Entries
   queue on the phone and send when a connection returns.
3. The Mac app polls the mailbox every 30 s (`src/main/phoneRelay.ts`),
   imports entries through the normal capture parser, and deletes them
   from the mailbox after a durable commit. It also **pushes your
   category list and learned capture phrases up** so the phone's preset
   chips always match the Mac.

### One-time setup

Deploy the Worker (needs a free Cloudflare account + `wrangler login`):

```sh
cd phone-relay
npx wrangler d1 create hourly-logger-relay   # copy database_id into wrangler.toml
npx wrangler d1 execute hourly-logger-relay --remote --file=schema.sql -y
npx wrangler deploy
openssl rand -hex 20                          # this is your relay token
npx wrangler secret put RELAY_TOKEN           # paste the token
```

Then, on the Mac: **Settings → Phone logging** — paste the Worker URL
(`https://hourly-logger-relay.<your-subdomain>.workers.dev`) and the
token, enable, and hit **Test connection** (this also pushes your
categories to the phone).

(Or, with the app quit: `./configure-mac.sh <url> <token>` writes the
settings directly.)

Then, on the iPhone: click **Copy phone link** in Settings (it's the
Worker URL with `#t=<token>` appended), get it to your phone (AirDrop /
Notes / iMessage-to-yourself), open it in Safari, then
Share → **Add to Home Screen**. Done — the token is remembered on the
phone; the link never needs opening again.

> The link contains your secret token. Don't share it. If it ever leaks,
> rotate: `npx wrangler secret put RELAY_TOKEN` with a new value, update
> the Mac setting, and re-open the new link on the phone.

### Using it

- **Type** in the box and hit **Log** — the text runs through the same
  parser as quick capture (`deep work 2-3pm`, `lunch`, `gym then
  errands` all work; a timeless entry becomes a
  `phoneInboxDefaultMinutes`-length block starting now).
- **Tap a chip** (a category, or a phrase the Mac has learned) to fill
  the box — tweak times if you like, then Log.
- **Voice**: the in-page mic button records audio and transcribes it with
  **Whisper (large-v3-turbo)** on Workers AI — noticeably better than
  Apple's keyboard dictation, especially with names and run-on phrases.
  Tap to start (pulsing red), tap again to stop; the transcript appends
  to whatever's already in the box. Recordings cap at 2 minutes; the
  keyboard's own mic key still works as a fallback (and is the offline
  option, since Whisper needs a connection).
- **"Start from my last entry (ends now)"** prefixes
  `from last event till now …`, so the block spans from the end of your
  last logged block to the moment you hit Log — perfect for "that walk I
  just finished".
- Anything the parser can't match to a category is filed under **"Phone
  log"** for re-filing later — nothing is ever dropped.
- **Last 2 hours** — a mini view of your recent timeline (colored bar +
  the latest entries with times), so you can see where your last block
  ended before logging the next one. The Mac pushes it alongside the
  preset catalog whenever your blocks change (≤30 s behind), and a small
  "from Mac Nm ago" stamp shows how fresh the snapshot is.

### Cost & limits

Free-tier arithmetic: polling every 30 s ≈ 2,880 Worker requests/day
(limit: 100,000/day) and the same order of D1 reads (limit: 5M/day).
Catalog pushes only happen when something changed. Voice transcription
uses the Workers AI free allocation (10,000 neurons/day ≈ several hours
of Whisper audio). You will not hit the limits.

## iCloud inbox (the legacy Shortcut path)

Still fully supported — an iOS Shortcut writes one JSON file per entry
(`{ "text": "...", "ts": "..." }`) into `iCloud Drive/HourlyLogger/inbox/`;
the Mac watches the folder, imports, and files entries into `processed/`
(malformed ones into `failed/`). Toggle via `phoneInboxEnabled`; point at
a custom folder via `phoneInboxFolderPath`.

<details>
<summary>Building the Shortcut</summary>

Open **Shortcuts** on the iPhone → **+**, add:

1. **Ask for Input** (Text) — prompt: `Log what?` (use **Dictate Text**
   for voice).
2. **Date** → current date/time.
3. **Format Date** → ISO 8601 with time (call it `Formatted Date`).
4. **Dictionary** — `text`: Provided Input, `ts`: Formatted Date.
5. **Number** → Random Number 100000–999999 (call it `Random`).
6. **Save File** → iCloud Drive, Ask Where to Save OFF, path
   `HourlyLogger/inbox/[Formatted Date]-[Random].json`.

Trigger it from the Home Screen, Siri, the Action Button, or Back Tap.

</details>

## Shared behavior & privacy

- Entries logged while the Mac app is closed simply wait (in the Worker
  mailbox or the iCloud folder) and import on next launch.
- Each entry has a unique id and the Mac keeps a processed-ids ledger per
  transport, so nothing can import twice — even if an ack or an iCloud
  delete goes missing.
- Relay entries transit your own Cloudflare account and are deleted from
  it after import; iCloud entries never leave Apple + your machines. The
  timeline database itself stays local either way.
