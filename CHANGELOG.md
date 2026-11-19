# Changelog

All notable changes to Life is short are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Before 1.0 the planner changes quickly; minor versions mark milestones.

## [Unreleased]

### Added

- Claude builds your goals and their flow charts: `change_goals` takes the chart builder's operations (goals, sub-goals, key results, steps, waiting steps, arrows, edits, moves, removals; up to 40 in one call), and `get_goal` shows one goal in full with its chart as Mermaid and its history. `supabase/migrations/0011_connector_goals.sql` lets a connection write goals and the charts' history.
- A task Claude adds, finishes, reopens, renames or moves on a goal goes in that goal's chart history, as in the app.
- Everything about a goal can be changed by saying so, through Claude or the planner's chat and chart bar. `move_goal` moves an existing goal, with its sub-goals, under another goal (serving one of its key results, or the goal as a whole) or back to the top, and reorders goals by rank. `delete_goal` deletes a goal and its sub-goals for good; their open tasks go off-goal, or are deleted too with `with_tasks` (never Google's), and done ones stay. `move_result` moves, nests and reorders key results. `edit_goal` sets a top goal's section (by name through Claude), `edit_step` changes how a repeating step repeats, and `move_step` moves a waiting step or a sub-goal to another goal too.
- MIT `LICENSE`, `CONTRIBUTING.md`, this changelog and `docs/ARCHITECTURE.md`.
- A project banner and a README with features, architecture, configuration and project structure up front.

### Changed

- The chart builder looks a step named by its title up on the operation's own goal when no chart is in focus.
- The chart builder finds an achieved or dropped goal by its title too, so it can be brought back or deleted by name.
- `change_goals` lists a goal as touched when only its repeating steps changed.
- Goal fields in Claude's tool schemas (rank, progress, a key result's parent) are bounded, so clients that read one type per field take them.

### Fixed

- `change_goals` → `edit_goal` ignored `parent` without a word. It now moves an existing goal under a parent (and one of its key results, with `for_result`) or to the top with `parent: null`, by the same rules as `add_goal`, and takes `rank` to reorder it.
- Goal sections: `add_goal` and `edit_goal` take `section` by label name or id, checked like a task's project. Sub-goals take their top goal's, and a task made on a goal takes the nearest section up the tree as its project.
- `add_step` takes `due` (YYYY-MM-DD), checked as `create_task` checks it.
- `link` between steps on two goals moved the task onto the other goal and lost its arrows. Arrows only join steps on one goal now, and drawing one never moves a task (that's refused with the reason; `move_step` moves it).
- `move_step` on a repeating task (`rep:<id>`) left its open task on the old goal, so it showed on both charts. Its open tasks move with it now, taking it off a goal takes them off too, and a chart shows a repeat's step only on the goal the repeat is on.
- Nothing an operation can't do is dropped silently: a field it doesn't take (unknown keys included), a value it can't read, a step it can't find, a change that changes nothing, a limit that would cut it (a goal too deep or under a closed one, a key result too deep) or a title cut to fit is listed under `skipped` with the reason.
- Bringing a goal back through the chart builder when 8 top goals were already open silently dropped another; it's refused now, with the reason.
- Removing a key result as a step left the arrows to the key results under it on the chart.

### Security

- Next.js 16.4.6, which fixes a known vulnerability in 16.4.3 (`next build` stopped to warn about it).

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
