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

## Sharing

Settings → Sharing gives someone a view-only window into your planner. You pick their email, what they see and for how long, and send them the link. Setup is in [`setup.md`](setup.md#5-sharing-optional-view-only-links). How it's locked down (`supabase/migrations/0005`):

- **Viewers never get an account.** `auth.users` still holds only you, sign-ups stay off and the breach checks still expect exactly one account. Shares, codes, viewer sessions, the activity log and suggestions live in the `private` schema, which the API can't read.
- **Only this app's server can act for a viewer.** The viewer's database functions (`share_code`, `share_sign_in`, `share_view`, `share_request`, `share_sign_out`) refuse any caller that doesn't present `SHARE_SERVER_KEY`. The database keeps only its sha256. The anon key alone, or a copied link, gets nothing.
- **The link plus a code from their inbox.** A link holds 192 random bits. To use it, the viewer types the email it was shared with and gets a 6-digit code by email (it lasts 10 minutes and allows 5 tries; at most one code a minute and five an hour per share). The answer is the same whether or not the email has access, so the form can't be used to find out who you share with. The database stores only hashes of codes and session tokens.
- **Sessions:** 7 days at most, never past the share's end, in an `HttpOnly`, `Secure`, `SameSite=Strict` cookie (`__Host-` on HTTPS) that the page's scripts can't read. Stop sharing, or Sign them out, ends every session at once. A share that runs out stops working on its own.
- **What a viewer can see** is decided in the database, per request: the backlog and/or the calendar (today on your clock, upcoming, or the past year too), with titles or as busy blocks only, and items pulled from Google only if you include them. They get titles, times, lengths, priorities and due dates. Never notes, the words of your dumps, your Google tokens, or events from calendars you switched off or accounts you hid. The name you give them stays with you. "See what they see" shows exactly the same data.
- **Suggestions** are stored apart from your tasks and change nothing until you approve one. Then the planner adds it like any task, with Undo. A share can turn suggestions off. Each share can hold at most 20 waiting, and 50 a day.
- **Everything is logged** in Settings → Sharing: codes sent, wrong codes, sign-ins, views (at most one every 30 minutes per session), suggestions and sign-outs, with the device (for example "Safari on iPhone", never the full browser string or IP), plus when you create, change or stop a share.
- **The weekly check** reports active shares, live viewer sessions and viewer sign-ins as counts. It warns on 10 or more wrong codes in a week, and on any sharing set up on the backup.
- Shares aren't backed up. After a restore, share again.
- **If `SHARE_SERVER_KEY` leaks**, make a new one and replace both the database hash and the Vercel variable (setup steps 1, 2 and 4). Someone holding the key, a link and that link's email could sign in as that viewer, but still only sees what that share shows.

## Backup database

A second Supabase project, in another region, holds a copy of your tasks. It has no app: it's only there to restore from. The two never hold each other's credentials, so a compromise of the primary database can't reach the backup.

- **Daily** (`.github/workflows/backup-sync.yml`): the job reads the primary through `backup_reader`, a read-only login, and overwrites the backup through `backup_writer`, which can only replace task rows. Before every overwrite it runs the breach checks below. If any of them **blocks**, it doesn't overwrite, and the backup keeps the last good copy.
- **Weekly** (`.github/workflows/backup-verify.yml`, Mondays): it repeats the checks on both databases, re-syncs, confirms the copies match byte for byte (by hash), and fails on warnings too. A failed run makes GitHub email you.
- **What's checked** (`scripts/backup/checks.mjs`): exactly one account, and it's yours; exactly one verified authenticator, and none added or changed recently; wrong PIN attempts; sign-ins that passed the password but not 2FA; sign-up, password-change and recovery events; row-level security on every table; the exact set of policies and functions; no access for signed-out visitors; the 2FA and sign-in rules unchanged and identical on both projects; no unexpected database logins; any sign-in, authenticator, PIN or sharing on the backup (it has no app); wrong viewer codes; mass deletions or mass edits; and a backup that was edited since the last sync.
- **Public logs:** the repo is public, so the job prints check names and counts only. It never prints emails, IPs or task text.

### Set up the backup

1. Create a second Supabase project, ideally under a separate Supabase organization.
2. SQL editor: run `supabase/migrations/0001` to `0005`, then `supabase/roles/backup_writer.sql`. Add the same user (same email, its own password; nobody signs in with it, it just owns the copied rows) and turn sign-ups off.
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
