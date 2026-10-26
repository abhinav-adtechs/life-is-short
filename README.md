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

### 1. Supabase

1. Create a project at supabase.com.
2. SQL editor: run `supabase/migrations/0001_init.sql` (tables, row-level security, realtime).
3. Authentication → Users → **Add user**: your email and a password, with auto-confirm on.
4. Authentication → Sign In / Providers: turn off **Allow new users to sign up**. It's a single-user app.
5. Authentication → URL Configuration: set **Site URL** to your Vercel URL so magic links come back to the app.
6. Project Settings → API: copy the project URL and the `anon` key for step 4.

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

Every API route requires a signed-in Supabase user.

## Keeping keys and tasks out of this public repo

- `.gitignore` excludes key/secret files (`.env*`, `*.pem`, `*.key`, SSH keys, `secrets/`, credentials) and task files (`tasks/`, `TASKS.*`, `todo.*`, `*.tasks`, `.claude/`).
- `.githooks/pre-commit` blocks those files even if force-added. It also rejects staged content that looks like an API key (including Google's `AIza…` and `AQ.…` formats) or a private key. Enable it once per clone:

  ```sh
  git config core.hooksPath .githooks
  ```

- Put secrets in `.env.local` (ignored) or in Vercel's environment variables, never in code.
