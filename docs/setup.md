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

Without Supabase keys the app runs in local-only mode (tasks in this browser). Without a Gemini key, dumps are sorted by the keyword parser and the toast says so.

## Set up for real (phone + laptop)

### 1. Supabase (primary)

1. Create a project at supabase.com.
2. SQL editor: run `supabase/migrations/0001` to `0005` in order, then `supabase/roles/primary_backup_reader.sql`.
3. Authentication → Users → **Add user**: your email and a long random password, with auto-confirm on.
4. Authentication → Sign In / Providers: turn off **Allow new users to sign up**, and turn off email OTP / magic links. It's a single-user app with password + authenticator only.
5. Authentication → Multi-Factor: keep **TOTP** enabled (the default).
6. Project Settings → API: copy the project URL and the `anon` key for Vercel.

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
3. Email for the codes: create a [Resend](https://resend.com) account, verify a domain you own, and make an API key with sending access only.
4. In Vercel add `SHARE_SERVER_KEY`, `RESEND_API_KEY` and `SHARE_EMAIL_FROM` (for example `Life is short <share@yourdomain.com>`), then redeploy.
5. Open Settings → Sharing. If anything is missing it says what; otherwise create a share and open the link in a private window to try it.

Locally you can skip Resend: without it, `npm run dev` prints each code to the terminal. To change the key later, repeat steps 1, 2 and 4: viewers stay signed in, and new codes use the new key.

### 6. Vercel

Import the GitHub repo. Under Settings → Environment Variables, add:

| name | value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key |
| `GEMINI_API_KEY` | Gemini key |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | OAuth client from step 4 |
| `SHARE_SERVER_KEY`, `RESEND_API_KEY`, `SHARE_EMAIL_FROM` | Sharing, from step 5 (optional) |
| `GOOGLE_SITE_VERIFICATION` | Search Console's HTML-tag token, only while proving you own the site for Google (optional) |

Redeploy after adding them; the `NEXT_PUBLIC_` values are baked in at build time.

## Settings reference

Open **Settings** from the `···` button. It's a full page (also reachable at `/app#settings`, or `/app#settings/calendar` and so on), and changes apply as you make them.

- **Appearance**: light, dark or system (per device); five themes (Neutral, Paper, Slate, Sage, Lilac), each with a light and a dark side; ten accent colours or your own (nudged until it reads against the background); nine fonts, including Lexend and Atkinson Hyperlegible for easier reading; text size; corner style; list density; increased contrast; pure black for OLED screens; motion (system, on, reduced); 12- or 24-hour clock. A live preview shows the result.
- **Calendar**: Day, 5 days (Monday to Friday, or the next 5 days), 7 days or Month; week start (Monday, Sunday or Saturday); your day (the hours the calendar shows and where tasks get slotted, also given to the AI); hour height; colour events by account, Google calendar, priority or none; show done tasks; shade weekends; ISO week numbers.
- **Google accounts**, **Your tasks** (import) and **Account** (password, sign out).
- **Sharing**: who can see your planner, what they see (backlog; calendar today, upcoming or all; titles or busy only; items from Google; whether they can suggest tasks) and until when; their signed-in devices, last visit, an activity log of every sign-in, view, wrong code and suggestion; their suggestions to approve or decline; "See what they see"; and Stop sharing, which signs them out at once. A badge on the planner shows suggestions waiting.

Light/dark and the calendar view stay on each device. Everything else is saved to your account and follows you to your other devices; the most recent change wins. The look is cached in the browser and applied before first paint, so there's no flash of the default theme.

## How it fits together

- `app/page.tsx` and `app/home.css`: the public home page at `/`. It says what the app does, what it reads from Google and why, and links the privacy policy (`app/privacy`), all without signing in, as Google's OAuth review requires. The planner is `app/app/page.tsx`, at `/app`.
- `lib/`: pure, tested logic ported from the prototype (`localParse`, `cleanItem`, `placeItem`, `findSlot`, `buildPrompt`, `applyCapture`), plus selectors for Now/Next, backlog, missed and done.
- `lib/repo/`: the storage interface, with a localStorage adapter and a Supabase adapter (RLS on `user_id`, realtime for cross-device sync).
- `app/api/sort`: Gemini with a JSON schema. A missing key or a failure tells the client to use the keyword parser.
- `lib/prefs.ts`, `lib/color.ts`: settings, themes, accents and fonts, turned into CSS variables (with contrast checks in the tests). `lib/calview.ts`: which days each calendar view shows.
- `app/api/google/*`: OAuth and pull, one call per account. Each refresh token is sealed with AES-GCM using a key derived from `GOOGLE_CLIENT_SECRET` before it's stored in your settings row.
- `components/`: the phone layout (under 860px) and the laptop layout with the drag-and-drop week calendar. Drag uses pointer events, so the same code handles touch.
- Sharing: `supabase/migrations/0005` (the share tables and functions), `app/api/share/*` (the viewer's sign-in, view and suggestions), `app/shared` and `components/SharedPlanner.tsx` (the viewer's page), `components/SharingSection.tsx` (Settings → Sharing) and `lib/share.ts`.

Every API route requires a signed-in Supabase user who passed 2FA in the last 24 hours, except the viewer's sharing routes (`/api/share/code`, `verify`, `view`, `suggest`, `sign-out`), which answer a viewer's emailed code or session instead.

## Keeping keys and tasks out of this public repo

- `.gitignore` excludes key/secret files (`.env*`, `*.pem`, `*.key`, SSH keys, `secrets/`, credentials) and task files (`tasks/`, `TASKS.*`, `todo.*`, `*.tasks`, `.claude/`).
- `.githooks/pre-commit` blocks those files even if force-added. It also rejects staged content that looks like an API key (including Google's `AIza…` and `AQ.…` formats) or a private key. Enable it once per clone:

  ```sh
  git config core.hooksPath .githooks
  ```

- Put secrets in `.env.local` (ignored) or in Vercel's environment variables, never in code.
