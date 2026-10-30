# Security and backups

How Life is short keeps your tasks yours, and how the backup database works. Setup steps for the app itself are in [`setup.md`](setup.md); the full go-live checklist is in [`go-live.md`](go-live.md).

## Signing in

- **First sign-in on a device:** email + password, then a 6-digit code from an authenticator app (TOTP), then, the very first time, choose a PIN (6–12 digits). There's no sign-up, password reset or email link in the app.
- **Every sign-in after that:** your **PIN + an authenticator code**, once every 24 hours. Never the password. The app locks itself when the 24 hours run out.
- **Or a passkey**, if you add one (Settings → Account): Face ID, Touch ID, Windows Hello, your phone or a security key, in place of all of the above, on a new device too. See [Passkeys](#passkeys).
- **Wrong PINs:** after 5 in a row, the PIN is erased and every session is signed out. You sign in with the password again and choose a new PIN.
- **The database enforces all of this** (`supabase/migrations/0004`, `0007`). Restrictive row-level security only returns or accepts rows for a session that passed an authenticator code in the last 24 hours **and** either signed in with the password or unlocked with the PIN in the last 24 hours, or that signed in with a passkey in the last 24 hours. The PIN is stored as a bcrypt hash and checked inside the database. A stolen password, PIN or session token alone reads nothing. The API routes ask the database the same question.
- **Changing the PIN** (Settings → Account) needs a password sign-in in the last 10 minutes.
- **Browser hardening:** a strict nonce-based Content-Security-Policy (only our scripts run; the page talks only to itself and Supabase), no framing, HSTS, no referrer, and no caching of API responses.
- **Lost your phone?** Remove the factor in Supabase → Authentication → Users → your user → MFA factors, then sign in with your password and set up a new one.

## Passkeys

A passkey is a key pair your device makes for this site: the private half never leaves the device (or your iCloud Keychain, Google Password Manager or password manager, which sync it), and Supabase keeps the public half. Setup is in [`setup.md`](setup.md#7-passkeys-optional-face-id-touch-id-windows-hello).

- **Why it can stand in for the PIN and the code:** it proves two things at once, the device you hold and that it's you, because the app always asks the device to check (your face, your finger or the device's PIN). And it only answers this site, so a look-alike page can't phish it. A session that signed in with a passkey sees your data for 24 hours, then locks like any other (`supabase/migrations/0007`); the API routes ask the database the same question.
- **Always checking it's you:** Supabase asks for that check as "preferred". The app asks for it as "required" every time, so a security key without a PIN can't be added, and every prompt asks for your face, finger or device PIN. Apple, Google and Windows passkeys always check anyway.
- **Adding or removing one needs an authenticator code**, even on a passkey session: Supabase wants a code-verified (aal2) session to manage passkeys while 2FA is on. So does moving the authenticator to a new app, and changing the password. Changing the PIN still needs a password sign-in in the last 10 minutes.
- **Supabase counts a passkey sign-in as one step (aal1).** Whenever an authenticator code is entered, on any device, Supabase signs out every session of yours that hasn't passed a code, passkey sessions on your other devices included. Those devices show the sign-in screen, which leads with **Sign in with a passkey**: one tap.
- **The weekly check lists every passkey.** It blocks on a passkey belonging to another account, warns when one was added in the last 8 days (so one you didn't add gets you an email), and warns on any passkey on the backup.
- **Lost a device?** Remove its passkey in Settings → Account, or in Supabase → Authentication → Users. A synced passkey lives on in your other devices' keychains: remove it there too if you're done with it.

## Sharing

Settings → Sharing gives someone a view-only window into your planner. You pick their email, what they see and for how long, and send them the link. Setup is in [`setup.md`](setup.md#5-sharing-optional-view-only-links). How it's locked down (`supabase/migrations/0005`):

- **Viewers never get an account.** `auth.users` still holds only you, sign-ups stay off and the breach checks still expect exactly one account. Shares, codes, viewer sessions, the activity log and suggestions live in the `private` schema, which the API can't read.
- **Only this app's server can act for a viewer.** The viewer's database functions (`share_code`, `share_sign_in`, `share_view`, `share_request`, `share_sign_out`) refuse any caller that doesn't present `SHARE_SERVER_KEY`. The database keeps only its sha256. The anon key alone, or a copied link, gets nothing.
- **The link plus a code from their inbox.** A link holds 192 random bits. To use it, the viewer types the email it was shared with and gets an 8-digit code by email. It lasts 10 minutes and allows 5 tries; a share sends at most one code a minute and five an hour, and 10 wrong codes in a day pause signing in to it for the rest of that day (Settings → Sharing says so). That leaves a guesser about a 1 in 27,000 chance a year. The answers, and how long they take, are the same whether or not the email has access, so the forms can't be used to find out who you share with. The database stores only hashes of codes and session tokens.
- **Sessions:** 7 days at most, never past the share's end, in an `HttpOnly`, `Secure`, `SameSite=Strict` cookie (`__Host-` on HTTPS) that the page's scripts can't read. Stop sharing, or Sign them out, ends every session at once. A share that runs out stops working on its own.
- **What a viewer can see** is decided in the database, per request: the backlog and/or the calendar (today on your clock, upcoming, or the past year too), with titles or as busy blocks only, and items pulled from Google only if you include them. They get titles, times, lengths, priorities and due dates. Never notes, the words of your dumps, your Google tokens, or events from calendars you switched off or accounts you hid. The name you give them stays with you. "See what they see" shows exactly the same data.
- **Suggestions** are stored apart from your tasks and change nothing until you approve one. Then the planner adds it like any task, with Undo. A share can turn suggestions off. Each share can hold at most 20 waiting, and 50 a day.
- **Everything is logged** in Settings → Sharing: codes sent, wrong codes, sign-ins, views (at most one every 30 minutes per session), suggestions and sign-outs, with the device (for example "Safari on iPhone", never the full browser string or IP), plus when you create, change or stop a share.
- **The weekly check** reports active shares, live viewer sessions and viewer sign-ins as counts. It blocks if signed-out visitors can call any function beyond the viewer's six, or if the sharing functions differ between primary and backup. It warns on 10 or more wrong codes in a week, a sharing key set or changed in the last 8 days, and any sharing set up on the backup.
- Shares aren't backed up. After a restore, share again.
- **The mail login is a password too.** A Gmail app password can read and send that account's mail, so send codes from a Gmail account made only for this, not your personal one. It's only used to send over TLS, and it's never logged, even when the mail server refuses it. Revoke it at myaccount.google.com/apppasswords if it leaks.
- **Treat `SHARE_SERVER_KEY` like a database password.** Someone holding it, a link and that link's email could sign in as that viewer without their inbox, though they'd still only see what that share shows. If it leaks, make a new one and replace both the database hash and the Vercel variable (setup steps 1, 2 and 4).

## Backup database

A second Supabase project, in another region, holds a copy of your tasks. It has no app: it's only there to restore from. The two never hold each other's credentials, so a compromise of the primary database can't reach the backup.

- **Daily** (`.github/workflows/backup-sync.yml`): the job reads the primary through `backup_reader`, a read-only login, and overwrites the backup through `backup_writer`, which can only replace task rows. Before every overwrite it runs the breach checks below. If any of them **blocks**, it doesn't overwrite, and the backup keeps the last good copy.
- **Weekly** (`.github/workflows/backup-verify.yml`, Mondays): it repeats the checks on both databases, re-syncs, confirms the copies match byte for byte (by hash), and fails on warnings too. A failed run makes GitHub email you.
- **What's checked** (`scripts/backup/checks.mjs`): exactly one account, and it's yours; exactly one verified authenticator, and none added or changed recently; passkeys, all yours and none added recently; wrong PIN attempts; sign-ins that passed the password but not 2FA; sign-up, password-change and recovery events; row-level security on every table; the exact set of policies and functions; no access for signed-out visitors; the 2FA and sign-in rules unchanged and identical on both projects; no unexpected database logins; any sign-in, authenticator, PIN, passkey or sharing on the backup (it has no app); wrong viewer codes; mass deletions or mass edits; and a backup that was edited since the last sync.
- **Public logs:** the repo is public, so the job prints check names and counts only. It never prints emails, IPs or task text.

### Set up the backup

1. Create a second Supabase project, ideally under a separate Supabase organization.
2. SQL editor: run `supabase/migrations/0001` to `0007`, then `supabase/roles/backup_writer.sql`. Add the same user (same email, its own password; nobody signs in with it, it just owns the copied rows) and turn sign-ups off.
3. On each project set the job login's password (SQL editor, a long random value, never committed):
   `alter role backup_reader with password '…';` on the primary, and `alter role backup_writer with password '…';` on the backup.
4. GitHub → Settings → Secrets and variables → Actions, add:

| secret | value |
|---|---|
| `PRIMARY_DB_URL` | the primary's **Session pooler** connection string, user `backup_reader.<primary-ref>` |
| `BACKUP_DB_URL` | the backup's **Session pooler** connection string, user `backup_writer.<backup-ref>` |
| `OWNER_EMAIL` | your sign-in email |
| `SUPABASE_CA_CERT` | not needed: the job checks the database against Supabase's CA, bundled in `scripts/backup/supabase-ca-2021.crt`. Set it only if Supabase replaces that CA |

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
