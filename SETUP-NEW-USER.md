# Setting up Hourly Logger on a new Mac

This repo was originally built as a personal tool. Everything in it works for
a new user, but a few things are tied to the original author's accounts and
must be recreated on yours. This guide lists exactly what those are. It's
written so that a coding assistant (e.g. Claude) can follow it end-to-end;
steps a human must do personally are marked **[you]**.

## TL;DR

| Piece | Works out of the box? | What you need to do |
|---|---|---|
| Mac app (timeline, Pomodoro, goals, quick capture, export/backup) | ✅ Yes — fully local, no accounts | Build and install it (below) |
| Calendar sync | ⚙️ Optional | Paste **your own** private iCal URLs into Settings |
| iPhone logging via phone relay | ⚙️ Optional | Deploy **your own** free Cloudflare Worker (below) |
| iPhone logging via iCloud Shortcut (legacy) | ⚙️ Optional | Build the Shortcut against **your own** iCloud Drive |

All data lives locally in `~/Library/Application Support/HourlyLogger/` —
nothing about the core app touches the network.

## 1. Build and install the Mac app

Requirements: an Apple Silicon Mac, Node.js (v20+), and the Xcode Command
Line Tools (`xcode-select --install`) so the native SQLite module can compile.

```sh
npm install --ignore-scripts
node node_modules/electron/install.js
npx electron-builder install-app-deps
npm run build
```

The `--ignore-scripts` dance is deliberate — see "Running in development" in
`README.md` for why (`better-sqlite3` must compile against Electron's Node,
not your system Node).

`npm run build` produces `release/HourlyLogger-<version>-arm64.dmg`. Open the
DMG and drag the app to Applications.

> **[you]** First launch: macOS may warn that the app is from an unidentified
> developer (it isn't code-signed). Right-click the app → **Open** → **Open**
> to get past Gatekeeper, one time.

> **Intel Mac?** The build targets `--arm64`. On an Intel Mac change
> `--arm64` to `--x64` in the `build` script in `package.json`.

That's it — the app is fully usable at this point. Everything below is
optional.

## 2. Calendar sync (optional)

The app can pull events from any iCal/ICS feed into the Plan lane.

> **[you]** Get your calendar's **private/secret iCal URL** (in Google
> Calendar: Settings → your calendar → *Secret address in iCal format*) and
> paste it into the app under **Settings → Calendar sync**. Treat that URL
> like a password — anyone who has it can read your calendar.

Nothing in the repo contains the original author's calendar URLs; these live
only in your local settings file.

## 3. iPhone logging — phone relay (optional, recommended)

`phone-relay/` is a tiny self-hosted mailbox: a Cloudflare Worker + D1
database + home-screen web app. The full walkthrough is in
`IPHONE-SETUP.md`; the short version, with the account-specific parts called
out:

1. **[you]** Create a free Cloudflare account (the free tier covers this
   comfortably), then authenticate the CLI: `npx wrangler login`.
2. Create **your own** database — the `database_id` currently in
   `phone-relay/wrangler.toml` belongs to the original author's account and
   will not work for you:
   ```sh
   cd phone-relay
   npx wrangler d1 create hourly-logger-relay
   ```
   Replace `database_id` in `wrangler.toml` with the id it prints, then load
   the schema:
   ```sh
   npx wrangler d1 execute hourly-logger-relay --remote --file=schema.sql
   ```
3. Generate **your own** secret token and deploy:
   ```sh
   openssl rand -hex 20                 # this is your relay token — save it
   npx wrangler secret put RELAY_TOKEN  # paste the token when prompted
   npx wrangler deploy
   ```
4. In the Mac app: **Settings → Phone logging** → paste your Worker URL
   (`https://hourly-logger-relay.<your-subdomain>.workers.dev`) and the
   token, enable, and hit **Test connection**.
5. **[you]** On your iPhone: open the setup link the app shows (it embeds
   your token), then Share → **Add to Home Screen**. Don't share that link —
   it contains the token. If it leaks, rotate with
   `npx wrangler secret put RELAY_TOKEN` and reconfigure both ends.

## 4. iPhone logging — iCloud Shortcut (legacy, optional)

An older path drops JSON files into `iCloud Drive/HourlyLogger/inbox/` via an
Apple Shortcut, which the Mac app imports. It requires no server at all, just
your own iCloud. Steps are in `IPHONE-SETUP.md` under "iCloud inbox".

## What you do NOT need

- No API keys, no `.env` files, no paid services anywhere.
- No account of the original author's — nothing in this repo grants access to
  his Cloudflare, calendar, or data, and your instance shares nothing with his.
- The app never sends your logged data anywhere except the optional relay
  **you** deploy and the daily local backups it writes itself.
