# Weight Tracker

A simple, mobile-friendly body weight tracker. Runs entirely in the browser —
no backend, no build step. Data lives in IndexedDB on each device, with
optional Google Drive sync to share it across devices.

## Features

- Date picker (defaults to today); picking a date with an existing entry
  loads it for editing. Otherwise it's pre-filled with the closest prior
  entry (e.g. yesterday's weight), or 80.0 kg if there's no data yet.
- Weight entry in kg with one decimal, plus ▲/▼ buttons that nudge by 0.1 kg.
- "OK" saves (inserts or updates) the entry for the selected date.
- Trend chart with three views: Per day, Average per week, Every Monday.
- Optional Google Drive (AppData folder) sync, so the same log follows you
  across phone/laptop/tablet.
- Manual JSON export/import as a backup independent of Drive.
- Installable as a PWA (works offline, "Add to Home Screen" on a phone).

## Running it

No build step — just serve the folder statically, e.g.:

```bash
npx serve .
```

or open `index.html` directly (Drive sync requires being served over
`http://` / `https://`, not `file://`, since Google OAuth needs an origin).

## Releasing a change

There's no build step, so the footer's version/build shown in the app is
maintained by hand in [`js/version.js`](js/version.js) — bump it in the same
commit as the change it ships:

- `APP_VERSION` — bump the patch digit for fixes, minor for new features.
- `APP_BUILD` — set to today's date plus a sequence number
  (`YYYY.MM.DD.N`), so you can tell which deploy is live by comparing the
  footer on [the live site](https://bluewael.github.io/WeightTracker/) against
  the latest commit.

Pushing to `main` deploys automatically via GitHub Pages (usually live within
a minute or two).

## Setting up Google Drive sync (optional)

Each deployment needs its own OAuth 2.0 Client ID — none is baked in.

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → APIs &
   Services → Credentials.
2. Enable the **Google Drive API** for your project.
3. Configure the OAuth consent screen (External is fine for personal use;
   add your own Google account as a test user — no verification needed for
   personal/testing use).
4. Create Credentials → **OAuth client ID** → Application type **Web
   application**.
5. Under **Authorized JavaScript origins**, add the URL you're hosting this
   app at (e.g. `https://you.github.io`, or `http://localhost:8080` while
   testing locally).
6. Copy the generated Client ID and paste it into the app's **Sync** tab.

The Client ID is stored in `localStorage` on each device (it's a public
identifier, not a secret — the security boundary is the "Authorized
JavaScript origins" list above). Sign-in tokens are never stored; they're
re-requested silently on each visit.

## Wear OS companion (future idea)

A phone-side app already covers the "log a number fast" use case reasonably
well, but a Wear OS complication/tile could make morning weigh-ins a
one-tap affair. That would need a native (Kotlin/Compose) Wear OS app,
separate from this web app, that either:

- talks to the Google Drive API directly with its own OAuth client, using
  the same `weighttracker.json` file shape this app writes, or
- calls a small companion endpoint on the phone via the Wearable Data
  Layer API.

Not implemented here — noted for later since it changes the tech stack
(native Android, not just HTML/JS).
