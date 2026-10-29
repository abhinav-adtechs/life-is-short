# Setting up Life is short

Next.js (App Router) + TypeScript, plain CSS with custom properties, Supabase for storage and sync, Gemini for sorting dumps, deployed on Vercel.

The full ordered checklist for going live, including the backup and GitHub secrets, is in [`go-live.md`](go-live.md). Security and the backup database are covered in [`security.md`](security.md).

## Run it locally

```sh
npm install
cp .env.example .env.local   # fill in what you have; everything is optional locally
npm run dev                  # http://localhost:3000 is the home page; the planner is at /app
npm test                     # unit tests for the parser, slotting, capture and Google merge
```

Without Supabase keys the app runs in local-only mode (tasks in this browser). Without a Gemini key, dumps are sorted by the keyword parser and the plan says so.

## Set up for real (phone + laptop)

### 1. Supabase (primary)

1. Create a project at supabase.com.
2. SQL editor: run `supabase/migrations/0001` to `0007` in order, then `supabase/roles/primary_backup_reader.sql`.
   Already running an older copy? Run each new migration on the primary **and** the backup before you deploy the code that needs it (`0006` adds labels: the app writes the new column and the backup job copies it; `0007` adds Face ID, and the weekly check wants the 2FA rule identical on both).
3. Authentication → Users → **Add user**: your email and a long random password, with auto-confirm on.
4. Authentication → Sign In / Providers: turn off **Allow new users to sign up**, and turn off email OTP / magic links. It's a single-user app with password + authenticator only.
5. Authentication → Multi-Factor: keep **TOTP** enabled (the default).
6. For Face ID on iPhone and iPad (optional): Authentication → Passkeys, turn on **Enable Passkey authentication**, and set **Relying Party Display Name** `Life is short`, **Relying Party ID** your app's domain with no `https://` (say `lifeisshort.vercel.app`) and **Relying Party Origins** its full address (`https://lifeisshort.vercel.app`). Pick the domain you'll keep: changing the ID makes every Face ID set-up stop working. Supabase marks passkeys experimental. The app never signs in with a passkey alone; see [`security.md`](security.md#face-id).
7. Project Settings → API: copy the project URL and the `anon` key for Vercel.

### 2. Load your tasks

Your tasks file never goes in this repo. On your machine:

```sh
node scripts/seed-sql.mjs ~/path/to/tasks.json you@example.com > ~/seed.sql
```

Paste `seed.sql` into the Supabase SQL editor and run it. It's safe to run again; existing ids are updated. Alternatively, sign in and use **Settings → Import from a file**.

### 3. Gemini (AI sorting)

Create a key at aistudio.google.com. The free tier is enough. The route tries `gemini-3.1-flash-lite`, then `gemini-flash-lite-latest`; set `GEMINI_MODEL` to a comma-separated list to change that.

### 4. Google Calendar and Tasks (optional, read-only pull, up to 5 accounts)

1. In Google Cloud console, create a project and enable the **Google Calendar API** and **Google Tasks API**.
2. Set up the OAuth consent screen (External) and add your account as a test user. Then **publish** it ("In production"). Apps left in Testing get refresh tokens that expire after 7 days. A personal app in production without Google verification shows a "Google hasn't verified this app" screen once; continue past it.
   - Branding: app name **Life is short**, exactly as the home page writes it; app home page `https://<your-app>/`; privacy policy `https://<your-app>/privacy`. Both pages load without signing in. Verification needs a domain you own: see [go-live.md → Google verification](go-live.md#google-verification-optional).
3. Credentials → Create OAuth client ID → **Web application**. Add the authorized redirect URIs `https://<your-app>.vercel.app/google/callback` and `http://localhost:3000/google/callback`.
4. In the app: **Settings → Google accounts → Connect Google**. Google's account chooser opens; pick an account and allow access. Use **Add another account** for a second or third (personal and work, say). Every account's events land on one calendar, each in its own colour.
   - It pulls today through the next month from each account's own calendars, plus its Google Tasks, then again every 30 minutes while the app is open. Changes in Google update the title and time here; priority, notes and done state stay yours.
   - Per account: pick its colour, hide it from the calendar, turn its Google Tasks off, and choose which calendars to pull (subscribed ones like holidays are off until you tick them).
   - A meeting that's on two of your accounts shows once.
   - If Google ends access for one account, it's marked **Reconnect**; the others keep pulling. **Disconnect** can keep that account's events or remove them (with Undo).

### 5. Sharing (optional, view-only links)

Settings → Sharing lets someone see your planner, view only: you pick their email, what they see and for how long, and send them the link. They sign in with an 8-digit code emailed to that address. How it's locked down is in [`security.md`](security.md#sharing).

1. Make a server key and keep it for Vercel (step 6):

   ```sh
   openssl rand -base64 33
   ```

2. Give the database its sha256, never the key itself. On your machine:

   ```sh
   printf %s '<the key>' | shasum -a 256
   ```

   Then in the Supabase SQL editor: `select private.set_share_key_hash('<the 64 hex characters>');`
3. Email for the codes, one of:
   - **Gmail, no domain needed.** Best with a Gmail account made just for this (say `lifeisshort.codes@gmail.com`): an app password can read and send that account's mail, so keep it away from your personal inbox. In that account, turn on 2-Step Verification (myaccount.google.com → Security), then create an app password (myaccount.google.com/apppasswords). Gmail sends up to about 500 emails a day.
   - **Resend, with a domain you own.** Create a [Resend](https://resend.com) account, verify the domain there, and make an API key with sending access only. Resend can't send from a Gmail address.
4. In Vercel add `SHARE_SERVER_KEY`, then for Gmail `SHARE_SMTP_USER` (the Gmail address) and `SHARE_SMTP_PASS` (the 16-letter app password), or for Resend `RESEND_API_KEY` and `SHARE_EMAIL_FROM` (for example `Life is short <share@yourdomain.com>`). Redeploy.
5. Open Settings → Sharing. If anything is missing, or the mail server refuses the login, it says what. Otherwise create a share and open the link in a private window to try it.

When the Gmail settings are there they're used, even if Resend's are too. With Gmail, leave `SHARE_EMAIL_FROM` unset (codes come from the Gmail address, as "Life is short") or set it to that same address; Gmail won't send as anyone else. Another mail server works the same way with `SHARE_SMTP_HOST` and `SHARE_SMTP_PORT` (465 for TLS, 587 for STARTTLS).

Locally you can skip email: without it, `npm run dev` prints each code to the terminal. To change the key later, repeat steps 1, 2 and 4: viewers stay signed in, and new codes use the new key.

### 6. Vercel

Import the GitHub repo. Under Settings → Environment Variables, add:

| name | value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key |
| `GEMINI_API_KEY` | Gemini key |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | OAuth client from step 4 |
| `SHARE_SERVER_KEY`, plus `SHARE_SMTP_USER` and `SHARE_SMTP_PASS` (Gmail) or `RESEND_API_KEY` and `SHARE_EMAIL_FROM` (Resend) | Sharing, from step 5 (optional) |
| `GOOGLE_SITE_VERIFICATION` | Search Console's HTML-tag token, only while proving you own the site for Google (optional) |

Redeploy after adding them; the `NEXT_PUBLIC_` values are baked in at build time.

## Settings reference

Open **Settings** from the header on a laptop or the `•••` menu on a phone. It slides in as a side panel (a sheet on a phone), also reachable at `/app#settings`, or `/app#settings/calendar` and so on, and changes apply as you make them. **Analytics** (`/app#analytics`) and **Share** (`/app#share`) open the same way.

- **Appearance**: three themes, Tide (light), Night train (dark) and Day train (light), or match your device (Night train when it's dark, Tide when it's light); the theme's own accent, one of ten others or your own (nudged until it reads against the background); ambient light (Present, Quiet or Still: the wave, the passing light and the lamp); motion (system, on, reduced; reduced also holds the ambient light still); nine fonts, including Lexend and Atkinson Hyperlegible for easier reading; text size; list density; increased contrast; 12- or 24-hour clock.
- **Calendar**: your day (the hours the calendar fits to and where tasks get slotted, also given to the AI); week start (Monday, Sunday or Saturday); what 5 days shows (the next 5 days, or Monday to Friday); hour height on a phone; colour events by label (the default), account, Google calendar, priority or none; show done tasks; shade weekends; ISO week numbers. On a laptop the divider picks how many days the calendar shows (1, 2, 3, 5 or 7).
- **Labels**: the parts of your life your tasks sort into (Work, Personal and Helping others to start). Rename, recolour, reorder, add up to 12 or remove them. The AI picks a label for each thing you dump, a `#tag` that names one picks it without the AI, and the task editor changes it. The backlog is a matrix of label by priority: click or tap a cell to filter the list to it.
- **Google accounts**: connect, pull, colour, show or hide each account; give it a default label (and a calendar inside it another), so its events show in that label's colour. **Your tasks** (import) and **Account** (PIN, password, sign out, and Face ID: set up on an iPhone or iPad, turned off from any device).
- **Sharing**: who can see your planner, what they see (backlog; calendar today, upcoming or all; titles or busy only; items from Google; whether they can suggest tasks) and until when; their signed-in devices, last visit, an activity log of every sign-in, view, wrong code and suggestion; their suggestions to approve or decline; "See what they see"; and Stop sharing, which signs them out at once. A badge on the planner shows suggestions waiting.

The theme, accent, ambient light and the laptop split stay on each device. Everything else is saved to your account and follows you to your other devices; the most recent change wins. The look is cached in the browser and applied before first paint, so there's no flash of the default theme.

## How it fits together

- `app/page.tsx` and `app/home.css`: the public home page at `/`. It says what the app does, what it reads from Google and why, and links the privacy policy (`app/privacy`), all without signing in, as Google's OAuth review requires. The planner is `app/app/page.tsx`, at `/app`.
- `lib/`: pure, tested logic ported from the prototype (`localParse`, `cleanItem`, `placeItem`, `findSlot`, `buildPrompt`, `applyCapture`), plus selectors for Now/Next, backlog, missed and done.
- `lib/repo/`: the storage interface, with a localStorage adapter and a Supabase adapter (RLS on `user_id`, realtime for cross-device sync).
- `app/api/sort`: Gemini with a JSON schema. A missing key or a failure tells the client to use the keyword parser.
- `lib/prefs.ts`, `lib/color.ts`: settings, themes, accents and fonts, turned into CSS variables (with contrast checks in the tests for each theme's text, accent and buttons). `lib/calview.ts`: which days each calendar view shows.
- `app/globals.css`: the three themes as tokens on `<html data-theme>`, the motion (row rise, check-and-strike, the Tide wave and wash, the passing light) and both layouts. `components/Ambient.tsx` adds the Night and Day train light, moved by CSS transforms and opacity only. `public/scenes/` holds the painted meadow the home page still uses (`python3 scripts/scenes/scenes.py`). `components/Brand.tsx`, `public/brand/` and `app/icon.svg`: the logo, a train window onto the summer meadow, drawn by `python3 scripts/brand/logo.py`; the favicon, home-screen icons, install manifest (`app/manifest.ts`) and link preview (`app/opengraph-image.png`) come from it, as `scripts/brand/README.md` lists.
- `app/api/google/*`: OAuth and pull, one call per account. Each refresh token is sealed with AES-GCM using a key derived from `GOOGLE_CLIENT_SECRET` before it's stored in your settings row.
- `components/`: `Phone.tsx` (under 860px) and `Laptop.tsx`, sharing `Next.tsx` (the Next task card), `Matrix.tsx`, `Calendar.tsx`, `Chat.tsx` (the chat bar, plan and history) and `Panel.tsx` (the editor, Analytics, Share and Settings as side panels or sheets). Drag uses pointer events, so the same code handles touch.
- The laptop layout: `lib/layout.ts` (the split between matrix and calendar as a fraction, its presets and the days each shows), `components/Split.tsx` (the divider), `lib/select.ts` (`visibleRange` fits the calendar to your day, `progress` feeds the header) and `lib/analytics.ts` (the week in Analytics).
- Labels: `lib/labels.ts` (the list, and which label a task or event has), `components/Labels.tsx` (the picker and Settings → Labels) and `supabase/migrations/0006` (the `label` column, also in the backup's comparison).
- Sharing: `supabase/migrations/0005` (the share tables and functions), `app/api/share/*` (the viewer's sign-in, view and suggestions), `app/shared` and `components/SharedPlanner.tsx` (the viewer's page), `components/SharingSection.tsx` (Settings → Sharing) and `lib/share.ts`.
- Face ID: `lib/faceid.ts` (spotting an iPhone or iPad, the passkey ceremony and its JSON), the unlock screen in `components/Auth.tsx`, Settings → Account in `components/Settings.tsx`, and `supabase/migrations/0007` (`face_id_unlock` and the 2FA rule that accepts it).

Every API route requires a signed-in Supabase user who passed 2FA (a code, or Face ID) in the last 24 hours, except the viewer's sharing routes (`/api/share/code`, `verify`, `view`, `suggest`, `sign-out`), which answer a viewer's emailed code or session instead.

## Keeping keys and tasks out of this public repo

- `.gitignore` excludes key/secret files (`.env*`, `*.pem`, `*.key`, SSH keys, `secrets/`, credentials) and task files (`tasks/`, `TASKS.*`, `todo.*`, `*.tasks`, `.claude/`).
- `.githooks/pre-commit` blocks those files even if force-added. It also rejects staged content that looks like an API key (including Google's `AIza…` and `AQ.…` formats) or a private key. Enable it once per clone:

  ```sh
  git config core.hooksPath .githooks
  ```

- Put secrets in `.env.local` (ignored) or in Vercel's environment variables, never in code.
