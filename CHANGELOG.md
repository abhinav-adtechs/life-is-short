# Changelog

All notable changes to Life is short are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Before 1.0 the planner changes quickly; minor versions mark milestones.

## [Unreleased]

### Added

- MIT `LICENSE`, `CONTRIBUTING.md`, this changelog and `docs/ARCHITECTURE.md`.
- A project banner and a README with features, architecture, configuration and project structure up front.

## [0.4.0] - 2026-11-11 — Connect Claude

### Added

- A remote **MCP server** at `/mcp` so Claude can use the planner as a custom connector, with OAuth 2.1 (PKCE, dynamic client registration, RFC 8414 and RFC 9728 discovery) and your planner sign-in as the consent screen.
- Database side of connecting Claude: connections, one-time codes and token-gated task functions (`supabase/migrations/0009_connectors.sql`), compared between primary and backup by the weekly check.
- Settings → Claude: the address to paste, every connection with when it was last used, and Disconnect.
- Docs for running, deploying publicly (Vercel, Fly.io, Railway, Render, Cloudflare Tunnel) and the URL to paste.
- The mic learns how you talk from every chat you apply: names, places, mishearings and phrasing, editable in Settings → Voice.
- `⌘K` to speak and a mic that shows where it's at.

### Changed

- A missed task keeps its slot for an hour before it goes back to the backlog.
- Tasks with no day or time stay off the calendar.
- Claude is told "its title follows Google" when it tries to change a Google-owned field.

### Fixed

- The weekly check no longer mistakes typing a code for a new authenticator.

## [0.3.0] - 2026-10-30 — Every screen

### Added

- **iPhone, iPad and Mac apps**: native shells around the planner with on-device dictation, Siri and Shortcuts, quick actions and a Mac menu bar, released through TestFlight.
- Sign in and unlock with a **passkey**, and let the Apple apps use the site's passkeys.
- **Face ID** after the PIN instead of the authenticator code on iPhone and iPad.
- **Repeat tasks**: "order groceries every Monday and Thursday".
- A **review** of how a day, week or month went, worked out from every task.
- Drag a task onto **Done** or the **trash**.

### Changed

- Redesigned the planner around three themes: **Tide**, **Night train** and **Day train**.
- Missed tasks go back to the backlog.
- Setup docs point at the Apple apps.

### Fixed

- The first Apple build: WebKit's cancelled-load error and speech prompts; the Mac app delegate now runs on the main actor.

## [0.2.0] - 2026-10-27 — Life is short

### Added

- **2FA**: an authenticator code, re-checked every 24 hours, enforced by the database.
- Sign in with **PIN + authenticator code** after the first login.
- A separate **backup database**, checked for breaches before every overwrite, with Supabase's root CA bundled so the job can verify it.
- A **settings page**, four calendar views and **multiple Google accounts**.
- **Sharing**: a view-only window into the planner, with sign-in codes sent through Gmail (no domain needed) in an email that looks like the app.
- **Labels** and a label × priority backlog matrix that shares the laptop screen with the calendar; the calendar is coloured by label.
- **Review a dump as a plan** before anything changes.
- A public home page and privacy page for Google's OAuth review, and the logo everywhere the app shows itself.
- The window seat: six painted views behind the planner, summer meadow by default.
- Docs: the security model, backup setup, emergency switch-over and a go-live runbook.

### Changed

- Renamed **Dump & Slot** to **Life is short**, and rewrote the README as a landing page.
- Tidied the laptop planner: a full-height calendar, visible misses, a grouped backlog.
- The backup guards compare rows, not browser timestamps, and skip the mass-edit guards when both copies already match.

### Fixed

- Sharing hardened after a security review.
- Account attribution, dedupe and sync edge cases across Google accounts.

## [0.1.0] - 2026-10-26 — Dump & Slot

### Added

- Next.js project with the planner logic ported over, with tests.
- Storage layer (browser or Supabase), sign-in, and the phone and laptop UI.
- Sort dumps with **Gemini**, using free-tier models with fallback and time limits.
- Pull **Google Calendar and Google Tasks**.
- Setup docs: Supabase, seeding tasks, Gemini, Google, Vercel.
- `.gitignore` and a pre-commit hook that keep keys and tasks out of the repo.

[Unreleased]: https://github.com/abhinav-adtechs/life-is-short/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/abhinav-adtechs/life-is-short/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/abhinav-adtechs/life-is-short/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/abhinav-adtechs/life-is-short/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/abhinav-adtechs/life-is-short/commits/v0.1.0
