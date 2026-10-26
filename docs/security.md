# Security and backups

How Life is short keeps your tasks yours, and how the backup database works. Setup steps for the app itself are in [`setup.md`](setup.md); the full go-live checklist is in [`go-live.md`](go-live.md).

## Signing in

- **First sign-in on a device:** email + password, then a 6-digit code from an authenticator app (TOTP), then, the very first time, choose a PIN (6–12 digits). There's no sign-up, password reset or email link in the app.
- **Every sign-in after that:** your **PIN + an authenticator code**, once every 24 hours. Never the password. The app locks itself when the 24 hours run out.
- **Wrong PINs:** after 5 in a row, the PIN is erased and every session is signed out. You sign in with the password again and choose a new PIN.
- **The database enforces all of this** (`supabase/migrations/0004`). Restrictive row-level security only returns or accepts rows for a session that passed an authenticator code in the last 24 hours **and** either signed in with the password or unlocked with the PIN in the last 24 hours. The PIN is stored as a bcrypt hash and checked inside the database. A stolen password, PIN or session token alone reads nothing. The API routes ask the database the same question.
- **Changing the PIN** (Settings → Account) needs a password sign-in in the last 10 minutes.
- **Browser hardening:** a strict nonce-based Content-Security-Policy (only our scripts run; the page talks only to itself and Supabase), no framing, HSTS, no referrer, and no caching of API responses.
- **Lost your phone?** Remove the factor in Supabase → Authentication → Users → your user → MFA factors, then sign in with your password and set up a new one.

## Backup database

A second Supabase project, in another region, holds a copy of your tasks. It has no app: it's only there to restore from. The two never hold each other's credentials, so a compromise of the primary database can't reach the backup.

- **Daily** (`.github/workflows/backup-sync.yml`): the job reads the primary through `backup_reader`, a read-only login, and overwrites the backup through `backup_writer`, which can only replace task rows. Before every overwrite it runs the breach checks below. If any of them **blocks**, it doesn't overwrite, and the backup keeps the last good copy.
- **Weekly** (`.github/workflows/backup-verify.yml`, Mondays): it repeats the checks on both databases, re-syncs, confirms the copies match byte for byte (by hash), and fails on warnings too. A failed run makes GitHub email you.
- **What's checked** (`scripts/backup/checks.mjs`): exactly one account, and it's yours; exactly one verified authenticator, and none added or changed recently; wrong PIN attempts; sign-ins that passed the password but not 2FA; sign-up, password-change and recovery events; row-level security on every table; the exact set of policies and functions; no access for signed-out visitors; the 2FA and sign-in rules unchanged and identical on both projects; no unexpected database logins; any sign-in, authenticator or PIN on the backup (it has no app); mass deletions or mass edits; and a backup that was edited since the last sync.
- **Public logs:** the repo is public, so the job prints check names and counts only. It never prints emails, IPs or task text.

### Set up the backup

1. Create a second Supabase project, ideally under a separate Supabase organization.
2. SQL editor: run `supabase/migrations/0001` to `0004`, then `supabase/roles/backup_writer.sql`. Add the same user (same email, its own password; nobody signs in with it, it just owns the copied rows) and turn sign-ups off.
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

### Restoring from the backup

1. Disable the **Backup sync** workflow, so nothing overwrites the backup while you work.
2. Make the primary safe again: rotate its database password and API keys (and recreate the project if needed: run the migrations and add your user).
3. From a checkout of this repo:

   ```sh
   BACKUP_DB_URL='<the BACKUP_DB_URL secret>' \
   RESTORE_TO_DB_URL='postgresql://postgres.<primary-ref>:<primary db password>@aws-0-ap-south-1.pooler.supabase.com:5432/postgres' \
   OWNER_EMAIL='<your email>' CONFIRM=overwrite-primary \
   node scripts/backup/run.mjs restore
   ```

   It replaces your tasks in the primary with the backup's, and checks the two match afterwards.
4. Re-enable **Backup sync**.
