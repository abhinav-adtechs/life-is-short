# Life is short

**Dump & Slot**, a personal planner. Dump a task the moment it comes to mind, by typing or by voice. A day or time puts it on the calendar; anything else waits in a prioritised backlog. The screen always shows the one thing to do now.

Next.js (App Router) + TypeScript, plain CSS with custom properties, Supabase for storage and sync, Gemini for sorting dumps, deployed on Vercel.

## Run it locally

```sh
npm install
cp .env.example .env.local   # fill in what you have; everything is optional locally
npm run dev                  # http://localhost:3000
npm test                     # unit tests for the parser, slotting, capture and Google merge
```

Without Supabase keys the app runs in local-only mode (tasks in this browser). Without a Gemini key, dumps are sorted by the keyword parser and the toast says so.

## Set up for real (phone + laptop)

### 1. Supabase (primary)

1. Create a project at supabase.com.
2. SQL editor: run `supabase/migrations/0001` to `0003` in order, then `supabase/roles/primary_backup_reader.sql`.
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

### 4. Google Calendar and Tasks (optional, read-only pull)

1. In Google Cloud console, create a project and enable the **Google Calendar API** and **Google Tasks API**.
2. Set up the OAuth consent screen (External) and add your account as a test user. Then **publish** it ("In production"). Apps left in Testing get refresh tokens that expire after 7 days. A personal app in production without Google verification shows a "Google hasn't verified this app" screen once; continue past it.
3. Credentials → Create OAuth client ID → **Web application**. Add the authorized redirect URIs `https://<your-app>.vercel.app/google/callback` and `http://localhost:3000/google/callback`.
4. In the app: **Settings → Connect Google**. It pulls events from your own calendars (today through the next month) and your Google Tasks, then pulls again every 30 minutes while the app is open. Changes in Google update the title and time here; priority, notes and done state stay yours.

### 5. Vercel

Import the GitHub repo. Under Settings → Environment Variables, add:

| name | value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key |
| `GEMINI_API_KEY` | Gemini key |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | OAuth client from step 4 |

Redeploy after adding them; the `NEXT_PUBLIC_` values are baked in at build time.

## How it fits together

- `lib/`: pure, tested logic ported from the prototype (`localParse`, `cleanItem`, `placeItem`, `findSlot`, `buildPrompt`, `applyCapture`), plus selectors for Now/Next, backlog, missed and done.
- `lib/repo/`: the storage interface, with a localStorage adapter and a Supabase adapter (RLS on `user_id`, realtime for cross-device sync).
- `app/api/sort`: Gemini with a JSON schema. A missing key or a failure tells the client to use the keyword parser.
- `app/api/google/*`: OAuth and pull. The refresh token is sealed with AES-GCM using a key derived from `GOOGLE_CLIENT_SECRET` before it's stored in your settings row.
- `components/`: the phone layout (under 860px) and the laptop layout with the drag-and-drop week calendar. Drag uses pointer events, so the same code handles touch.

Every API route requires a signed-in Supabase user who passed 2FA in the last 24 hours.

## Security

- **Sign-in:** email + password, then a 6-digit code from an authenticator app (TOTP). The first sign-in sets the authenticator up from a QR code. There's no sign-up, password reset or email link in the app.
- **Every 24 hours:** only the authenticator code is asked for again, not the password. The app locks itself when the 24 hours run out.
- **The database enforces it too.** Restrictive row-level security policies (`supabase/migrations/0002`) only return or accept rows for a session at `aal2` whose last authenticator code is under 24 hours old. A stolen password, or a stolen session older than a day, reads nothing. The API routes apply the same rule.
- **Browser hardening:** a strict nonce-based Content-Security-Policy (only our scripts run; the page talks only to itself and Supabase), no framing, HSTS, no referrer, and no caching of API responses.
- **Lost your phone?** Remove the factor in Supabase → Authentication → Users → your user → MFA factors, then sign in and set up a new one.

## Backup database

A second, independent Supabase project holds a copy of your tasks. The two never hold each other's credentials, so a compromise of the primary can't reach the backup.

- **Daily** (`.github/workflows/backup-sync.yml`): the job reads the primary through `backup_reader`, a read-only login, and overwrites the backup through `backup_writer`, which can only replace task rows. Before every overwrite it runs the breach checks below. If any of them **blocks**, it doesn't overwrite, and the backup keeps the last good copy.
- **Weekly** (`.github/workflows/backup-verify.yml`, Mondays): it repeats the checks on both databases, re-syncs, confirms the copies match byte for byte (by hash), and fails on warnings too. A failed run makes GitHub email you.
- **What's checked** (`scripts/backup/checks.mjs`): exactly one account, and it's yours; exactly one verified authenticator, and none added or changed recently; sign-ins that passed the password but not 2FA; sign-up, password-change and recovery events; row-level security on every table; the exact set of policies; no access for signed-out visitors; the 2FA rule unchanged and identical on both projects; no unexpected database logins; mass deletions or mass edits; and a backup that was edited since the last sync.
- **Public logs:** the repo is public, so the job prints check names and counts only. It never prints emails, IPs or task text.

### Set up the backup

1. Create a second Supabase project, ideally under a separate Supabase organization.
2. SQL editor: run `supabase/migrations/0001` to `0003`, then `supabase/roles/backup_writer.sql`. Add the same user (same email, its own password) and turn sign-ups off.
3. On each project set the job login's password (SQL editor, a long random value, never committed):
   `alter role backup_reader with password '…';` on the primary, and `alter role backup_writer with password '…';` on the backup.
4. GitHub → Settings → Secrets and variables → Actions, add:

| secret | value |
|---|---|
| `PRIMARY_DB_URL` | the primary's **Session pooler** connection string, user `backup_reader.<primary-ref>` |
| `BACKUP_DB_URL` | the backup's **Session pooler** connection string, user `backup_writer.<backup-ref>` |
| `OWNER_EMAIL` | your sign-in email |
| `SUPABASE_CA_CERT` | optional: Supabase's CA certificate (Project Settings → Database → SSL), to pin it |

5. Run **Actions → Backup sync → Run workflow** once to confirm it's green.

### If the primary is ever compromised

Disable the **Backup sync** workflow so nothing overwrites the backup. Then point the app at the backup: in Vercel, set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` to the backup project's values and redeploy. You can also keep a second Vercel project permanently pointed at the backup, so a live copy is always one URL away.

## Keeping keys and tasks out of this public repo

- `.gitignore` excludes key/secret files (`.env*`, `*.pem`, `*.key`, SSH keys, `secrets/`, credentials) and task files (`tasks/`, `TASKS.*`, `todo.*`, `*.tasks`, `.claude/`).
- `.githooks/pre-commit` blocks those files even if force-added. It also rejects staged content that looks like an API key (including Google's `AIza…` and `AQ.…` formats) or a private key. Enable it once per clone:

  ```sh
  git config core.hooksPath .githooks
  ```

- Put secrets in `.env.local` (ignored) or in Vercel's environment variables, never in code.
