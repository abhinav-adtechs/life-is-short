# Go-live runbook

Everything needed to take Life is short live, in order. Each step says what it unlocks. Steps marked *(account)* need your Supabase, Vercel, Google or GitHub account.

## 1. Primary database *(account: Supabase)*

1. Create a project. Pick a region near you (Mumbai, `ap-south-1`) and a strong database password, and keep that password in your password manager.
2. SQL editor, in order:
   `supabase/migrations/0001_init.sql`, `0002_require_fresh_2fa.sql`, `0003_audit_snapshot.sql`, `0004_pin_unlock.sql`, `0005_sharing.sql`, `0006_labels.sql`, `0007_face_id.sql`, then `supabase/roles/primary_backup_reader.sql`.
3. Authentication settings:
   - Sign In / Providers → Email: **Allow new users to sign up: off**. Minimum password length 16.
   - Multi-Factor: TOTP **enabled** (enroll and verify).
   - Passkeys, only for Face ID on iPhone and iPad: **Enable Passkey authentication** on, Relying Party ID = your Vercel domain, Origins = `https://` + that domain ([setup.md](setup.md#1-supabase-primary), step 6).
   - URL Configuration: Site URL = your Vercel URL from step 4.
4. Authentication → Users → Add user: your email, a long random password, auto-confirm on.
5. Load your tasks: run the seed SQL (generated with `node scripts/seed-sql.mjs <tasks.json> <email>`) in the SQL editor.

## 2. Backup database *(account: Supabase, ideally a separate organization)*

1. Create a second project.
2. SQL editor: `0001` to `0007`, then `supabase/roles/backup_writer.sql`. Don't set a sharing key on the backup: it has no app.
3. Same auth settings as above, without passkeys. Add the same email as a user, with its **own** password. Nobody signs in to the backup; the user only owns the copied rows.

## 3. Logins for the backup job *(account: Supabase)*

Generate two long random passwords (for example `openssl rand -base64 33`). Run:

- primary: `alter role backup_reader with password '<password 1>';`
- backup: `alter role backup_writer with password '<password 2>';`

Then build the **Session pooler** URLs (Connect → Session pooler), replacing the user and password:

- `postgresql://backup_reader.<primary-ref>:<password 1>@aws-0-<region>.pooler.supabase.com:5432/postgres`
- `postgresql://backup_writer.<backup-ref>:<password 2>@aws-0-<region>.pooler.supabase.com:5432/postgres`

## 4. Vercel *(account: Vercel)*

1. Add New → Project → import `abhinav-adtechs/life-is-short`.
2. Environment variables (Production and Preview):
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (primary), `GEMINI_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.
3. Deploy. Put the production URL into Supabase → URL Configuration (step 1.3).

## 5. Google Calendar and Tasks *(account: Google Cloud)*

1. console.cloud.google.com → new project → enable **Google Calendar API** and **Google Tasks API**.
2. OAuth consent screen: External, app name "Life is short" (exactly; Google checks it against the home page), your email as support contact, scopes `calendar.readonly` and `tasks.readonly`, and yourself as a test user. Under Branding: app home page `https://<vercel-url>/`, privacy policy `https://<vercel-url>/privacy`, and, if you want it, the app logo `public/brand/logo-120.png` (120×120). Google shows a logo only once it has verified the app's branding, and a new logo can start that review, so a personal app can leave it out.
3. **Publish app → In production.** In Testing mode Google expires the connection every 7 days. In production, unverified, Google shows a one-time "hasn't verified this app" screen; click Advanced → continue. Verification isn't needed for personal use.
4. Credentials → OAuth client ID → Web application. Redirect URIs: `https://<vercel-url>/google/callback` and `http://localhost:3000/google/callback`. Put the ID and secret into Vercel and redeploy.

### Google verification *(optional)*

Verification only removes the one-time "hasn't verified this app" screen; the app works without it. Google reviews the branding first:

- **The home page** is `/`. It loads without signing in, names the app, says what it does and what it reads from Google and why, and links `/privacy`. The planner is at `/app`.
- **App name**: "Life is short", exactly as on the home page.
- **A domain you own.** Google wants the home page on a site you've proved you own in [Search Console](https://search.google.com/search-console), signed in as an owner of the Google Cloud project. A `vercel.app` address can only be added as a URL-prefix property, and reviews often still reject it as "not registered to you", so a domain of your own is the dependable route:
  1. Buy a domain and add it in Vercel → Settings → Domains.
  2. Search Console → Add property → **Domain**, and add the TXT record it gives you at your DNS provider.
  3. Google Auth Platform → Branding: home page `https://<domain>/`, privacy policy `https://<domain>/privacy`, and `<domain>` under Authorized domains.
  4. Clients → your OAuth client: add `https://<domain>/google/callback`. Supabase → URL Configuration: Site URL `https://<domain>`.
  5. Wait 24 hours, then tell Google the issues are fixed.

  To try the `vercel.app` address first: Search Console → Add property → **URL prefix** → `https://<vercel-url>/` → HTML tag. Put the tag's `content` value in Vercel as `GOOGLE_SITE_VERIFICATION`, redeploy, then click Verify.

## 6. GitHub Actions secrets *(account: GitHub)*

Repo → Settings → Secrets and variables → Actions:
`PRIMARY_DB_URL`, `BACKUP_DB_URL` (from step 3) and `OWNER_EMAIL`. Supabase's certificate authority is bundled with the job, so `SUPABASE_CA_CERT` is only needed if Supabase replaces it.
Then Actions → **Backup sync** → Run workflow, and confirm it's green.

## 7. Sharing *(optional; account: Gmail or Resend)*

Only if you want to share view-only links. Follow [setup.md → Sharing](setup.md#5-sharing-optional-view-only-links): make `SHARE_SERVER_KEY`, put its sha256 in the database with `private.set_share_key_hash`, and add `SHARE_SERVER_KEY` to Vercel. Then add email for the codes: a Gmail app password (`SHARE_SMTP_USER`, `SHARE_SMTP_PASS`), or Resend on a domain you own (`RESEND_API_KEY`, `SHARE_EMAIL_FROM`). Settings → Sharing says if anything is missing.

## 8. First sign-in

Open `/app` → email + password → scan the QR code with an authenticator app → enter the code → choose a PIN. From then on you sign in with the PIN and an authenticator code, once a day.

On an iPhone or iPad, sign in the same way once, then Settings → Account → Face ID → **Set up** → **Use Face ID**. From then on that device unlocks with the PIN and Face ID; **Use a code instead** is always there.

## Checks after go-live

- In a private window, `/` and `/privacy` load without signing in; `/app` asks you to sign in.
- Sign out, sign in: password, then code. Wrong code is refused.
- A day later: PIN + code, no password. A wrong PIN is refused.
- With Face ID set up, a day later on the iPhone: PIN + Face ID, no code. Cancel Face ID: nothing unlocks.
- In another browser, sign in with the password only: no tasks load.
- The task you add on your phone shows on the laptop within a few seconds.
- Actions → Weekly security check → Run workflow: green.
- If you share: open a share link in a private window, sign in with the emailed code, and check you see only what you picked. Stop sharing, reload: it asks for the code again.
