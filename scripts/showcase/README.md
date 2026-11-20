# The showcase video and README images

Everything here records the planner running in your browser's local-only mode with **made-up demo data**
([`seed.mjs`](seed.mjs)): a podcast launch, a half marathon, an app's v2 and two people to mentor. No real planner,
account or key is involved, so it's safe to publish whatever it makes.

| Script | Makes |
| --- | --- |
| `capture.mjs`, then `compose.mjs` | `docs/images/hero-light.png`, `hero-dark.png`, `phone.png`, `themes.png`, `settings.png` |
| `record.mjs`, then `encode.sh` | `docs/media/showcase.mp4` (the full walkthrough, 1080p), `docs/media/showcase.gif` (the README's highlight) and `docs/images/dump.gif` |

## Run it

You need ffmpeg and Playwright with its Chromium (`npm install --no-save playwright && npx playwright install chromium`).

```sh
ALLOW_LOCAL_MODE=1 npm run build
ALLOW_LOCAL_MODE=1 npm start               # leave it running on :3000, with no Supabase keys set
node scripts/showcase/capture.mjs          # raw screenshots → scripts/showcase/out/raw
node scripts/showcase/compose.mjs          # framed images → docs/images
node scripts/showcase/record.mjs dry       # optional: one screenshot per scene → scripts/showcase/out/shots
node scripts/showcase/record.mjs           # the frames → scripts/showcase/out/frames
sh scripts/showcase/encode.sh              # → docs/media and docs/images/dump.gif
```

`out/` is gitignored.

## How it's put together

- **The stage** ([`stage.html`](stage.html)) is a 1920×1080 page served at `/__stage` by the script: title cards, the
  captions, a cursor, and the planner in a browser window or a phone, each an `<iframe>` of `/app` (the script strips the
  app's no-framing headers for the recording only).
- **The clock** is pinned to Friday 20 November 2026, 10:40 AM in `Asia/Kolkata`, so the calendar and the numbers come
  out the same every time.
- **The dump** runs without an AI key, so `record.mjs` answers `/api/sort` in the AI route's own shape: what Gemini
  returns for that dump. Everything else on screen is the app doing its own work.
- **The frames** come from Chrome's screencast, each held for as long as it was on screen, so the video plays at the
  speed it was recorded. It launches full Chromium (`channel: 'chromium'`); Playwright's headless shell crashed on
  `/app`.
- **The GIF cuts** in `encode.sh` are seconds into the video. If a scene gets longer or shorter, check them against the
  times `record.mjs` prints.
