# Contributing to Life is short

Thanks for taking the time. Life is short is a single-person planner that people run as their own private copy, so changes are judged by one question: does it help someone do the one thing that matters right now, with less to manage?

Please read the [Code of Conduct](https://github.com/abhinav-adtechs/.github/blob/main/CODE_OF_CONDUCT.md) before you take part. For security issues, don't open a public issue: follow the [security policy](https://github.com/abhinav-adtechs/.github/blob/main/SECURITY.md).

## Dev setup

You need Node.js 20 or newer (CI uses 22) and npm.

```sh
git clone https://github.com/abhinav-adtechs/life-is-short.git
cd life-is-short
npm install
git config core.hooksPath .githooks   # once per clone: blocks secrets and task files
npm run dev                           # http://localhost:3000, planner at /app
```

With no `.env.local` the planner runs in local-only mode (tasks in your browser) and sorts dumps with the keyword parser, which is enough for most UI and logic work. To work on sync, sign-in, sharing, Google or the MCP server, follow [`docs/setup.md`](docs/setup.md) with a Supabase project of your own. Never point a development copy at someone else's database.

The Apple apps live in `apple/` and need Xcode and XcodeGen: see [`apple/README.md`](apple/README.md) and [`docs/apple.md`](docs/apple.md).

## Scripts

| Command                                | Use it for                                                                      |
| -------------------------------------- | ------------------------------------------------------------------------------- |
| `npm run dev`                          | Running the app locally                                                         |
| `npm test`                             | All unit and SQL tests (Vitest; `lib/**/*.test.ts` and `scripts/**/*.test.mjs`) |
| `npm run typecheck`                    | `tsc --noEmit`                                                                  |
| `npm run build`                        | Production build; also type-checks                                              |
| `swift test --package-path apple/Core` | The Apple apps' Swift core (macOS only)                                         |

CI (`.github/workflows/ci.yml`) runs `npm ci --ignore-scripts`, `npm test` and `npm run build` on every pull request. Changes under `apple/`, `app/`, `components/` or `lib/` also run the Apple workflow (`.github/workflows/apple.yml`). Run the same commands locally before you push.

## Where things go

- **Logic** belongs in `lib/` as pure functions, with a `*.test.ts` beside it. The UI in `components/` should stay thin.
- **Server-only code** goes in `lib/server/` and imports `server-only`.
- **Database changes** are a new numbered file in `supabase/migrations/` (never edit an applied migration). If it touches the sign-in rules, sharing or connectors, update the breach checks in `scripts/backup/checks.mjs` and the SQL tests in `scripts/db/`, and say in the docs that it has to run on the backup too.
- **New environment variables** go in `.env.example` with a comment, and in the configuration table in the README and [`docs/setup.md`](docs/setup.md).
- **User-facing behaviour** gets a line in the README or the relevant doc, in the same plain voice.

## Branches and commits

- Branch from `main`: `feat/<short-name>`, `fix/<short-name>`, `docs/<short-name>`.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/): `feat: …`, `fix: …`, `docs: …`, `test: …`, `refactor: …`, `chore: …`, `ci: …`. Use the imperative mood, keep the subject under 72 characters, and explain _why_ in the body when it isn't obvious.
- Never commit `.env*` files, keys, or real tasks. The pre-commit hook catches the common cases; don't skip it with `--no-verify`.

## Filing issues

- **Bugs:** what you did, what you expected, what happened, and where (browser or app, phone or laptop, local-only or Supabase). Screenshots help; blur anything personal.
- **Ideas:** describe the problem first, then the change. Ideas that add things to manage are a hard sell; ideas that remove them are welcome.
- Check [existing issues](https://github.com/abhinav-adtechs/life-is-short/issues) first.

## Pull request checklist

- [ ] `npm test` and `npm run build` pass locally
- [ ] New logic in `lib/` has tests
- [ ] Database changes are a new migration, and the backup checks and SQL tests are updated if needed
- [ ] New settings or variables are documented (`.env.example`, README, `docs/setup.md`)
- [ ] UI changes work on a phone (under 860px) and a laptop, in Tide and Night train, and with reduced motion
- [ ] No secrets, personal data or real tasks in the diff
- [ ] The PR description says what changed and why, with a screenshot for UI changes

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
