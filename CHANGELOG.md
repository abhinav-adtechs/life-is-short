# Changelog

All notable changes to Life is short are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Before 1.0 the planner changes quickly; minor versions mark milestones.

## [Unreleased]

### Added

- **Done** on a goal archives it at once: on each goal's card on the main page, in Goals, on its map and on its route on a phone, with Undo. It says what went with it (its open sub-goals) and how many open tasks are off-goal now. One action for all of them, `closeGoal` in the planner, worded by `closingLine` in `lib/goals.ts`.
- The **Archive** (`components/Archive.tsx`, `#archive`): every goal marked done or dropped, newest first, a month at a time, with how long it took, its key results, its sub-goals and the tasks and time it took. Filter by done or dropped, find one by name, open its map, bring it back or delete it. It's beside **Edit goals** on the main page once something's in it, at the foot of Goals, and in the phone's ••• menu. An archived goal's map and route say so, with **Bring back**, and the map's trail leads back to the archive.
- A goal's **route**, top to bottom: **Up next** (the first step you can start on the critical path, in a sub-goal if that's where it is) with Done and a time for it and what it opens up, then what else is ready, what you're waiting on and for how long, the route still ahead to the finish, the sub-goals (each opening to its own route) and what's done. It drops down on each goal's card on the main page (**Route**, remembered in this browser), and it's what a goal opens to on a phone, with the map a tap away. Worked out in `lib/route.ts`, shown by `components/Route.tsx`.
- The map: the goal as a full-screen route to the finish, with floating controls (where you are and how far along, undo and history, a minimap and zoom, and a dock to add steps, bring in the backlog or change the plan in words). Each kind of step has its own shape: a card with a ring to tick, a sand capsule for what you wait on (with how long it's been), a flag for a key result, a stack of cards with its own ring for a sub-goal.
- Drag and drop that shows where it lands before you let go: onto an arrow puts it in between, and what comes after slides along to make room; onto a step puts it after, before or alongside it. Moving a step lines it up on guides. Drawing an arrow snaps to the step you reach and says why if it can't; let go on an empty spot for a new step there. A + on every arrow puts a step in between.
- Ticking a step off on the map: the check bursts, the arrows out of it fill in with the goal's colour, what it held up lifts with its lock gone, and the ring counts up. Hover a step to light up what comes before and after it. Space ticks the selected step off; ⇧1 fits the whole route; / jumps to the bar.
- An empty goal's map offers to draft a plan for it.
- Delete any goal for good in the app: **Delete** on every goal and sub-goal in Goals, and **Delete for good** on a sub-goal on its parent's map. It says what goes first (its sub-goals; its open tasks stay off-goal, or go too if you choose; done tasks stay), and offers Undo in the panel. It's the same change as Claude's `delete_goal`.
- `delete_goal`, an MCP tool of its own for what `change_goals`' `delete_goal` does.
- Repeating tasks through Claude: `create_task` and `update_task` take `repeat` (how often, and at what time of day each one goes on the calendar, read in your time zone). `update_task` makes a task repeat, changes or reschedules its series, or stops it with `repeat: null`, and takes a series' id (`rep:<id>`, shown by `get_task`) when none of it is open. A task on a goal keeps its arrows when it starts repeating.
- A goal's flow chart shows its whole tree: each sub-goal opens in place with its own chart to its right, as deep as they go, with its own arrows, and its steps work as on their own chart. A toggle on each sub-goal's card closes it to one card with how many steps are inside, remembered in this browser; one with nothing on it says "No tasks yet". Laid out in `lib/flowTree.ts`.
- `get_goal` takes a `depth`: over 1, each sub-goal step carries its own chart (steps, arrows, critical path) and the Mermaid has a subgraph per sub-goal. 1, the default, is as before.
- Claude builds your goals and their flow charts: `change_goals` takes the chart builder's operations (goals, sub-goals, key results, steps, waiting steps, arrows, edits, moves, removals; up to 40 in one call), and `get_goal` shows one goal in full with its chart as Mermaid and its history. `supabase/migrations/0011_connector_goals.sql` lets a connection write goals and the charts' history.
- A task Claude adds, finishes, reopens, renames or moves on a goal goes in that goal's chart history, as in the app.
- Everything about a goal can be changed by saying so, through Claude or the planner's chat and chart bar. `move_goal` moves an existing goal, with its sub-goals, under another goal (serving one of its key results, or the goal as a whole) or back to the top, and reorders goals by rank. `delete_goal` deletes a goal and its sub-goals for good; their open tasks go off-goal, or are deleted too with `with_tasks` (never Google's), and done ones stay. `move_result` moves, nests and reorders key results. `edit_goal` sets a top goal's section (by name through Claude), `edit_step` changes how a repeating step repeats, and `move_step` moves a waiting step or a sub-goal to another goal too.
- MIT `LICENSE`, `CONTRIBUTING.md`, this changelog and `docs/ARCHITECTURE.md`.
- A project banner and a README with features, architecture, configuration and project structure up front.

### Changed

- Bringing a goal back brings back the sub-goals that closed with it (the same way, at the same moment), not one you'd finished before it. Before, they stayed closed.
- **Achieved** is now **Done** on a goal, and Goals' collapsed **Achieved and dropped** list is a link to the Archive.
- "Flow chart" is now the **Map**. The goal is the finish, on the right, as a ring that fills as its work gets done; every step nothing comes after leads on to it (`buildFlow`'s `ends` and, with `finish`, lanes on to the goal), and the dashed lines from the goal to the first steps are gone. Done steps sit back and the route you've walked fills in with the goal's colour; the step to do now wears Up next; locked steps wait in grey.
- What you wait on, and a sub-goal, sit right before the step they're for rather than back at the start, so their arrows stay short.
- A sub-goal is one card on a map until you open it in place (as a frame with a header bar, its chart under it), remembered in this browser under `ds.flow.opened`.
- A change you ask for on the map is shown in green first, with what it'll do in words; **Make the changes** (or Enter) makes it, and one Undo still takes it all back.
- The chart builder looks a step named by its title up on the operation's own goal when no chart is in focus.
- The chart builder finds an achieved or dropped goal by its title too, so it can be brought back or deleted by name.
- `change_goals` lists a goal as touched when only its repeating steps changed.
- Goal fields in Claude's tool schemas (rank, progress, a key result's parent) are bounded, so clients that read one type per field take them.

### Fixed

- Deleting a dropped or achieved goal in Goals left its tasks naming a goal that was gone. They're made off-goal now, as Claude's delete does.
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
