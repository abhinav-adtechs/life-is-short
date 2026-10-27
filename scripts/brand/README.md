# The logo

A train window onto the summer meadow, the app's default view: a cream frame, a blue sky with the sun, a cloud and a
bird, and green fields with a band of rapeseed. `python3 scripts/brand/logo.py` draws it in two cuts:

- `public/brand/logo.svg`: rounded, with clear corners. The mark next to "Life is short" in the app, and
  `app/icon.svg`, the browser tab icon.
- `public/brand/logo-square.svg`: a full square, for places that round or crop the icon themselves.

The PNGs are those two files rendered at these sizes:

| File | Cut | Size | Where it shows |
| --- | --- | --- | --- |
| `app/favicon.ico` | rounded | 16, 32, 48 | Browser tabs and bookmarks that don't take SVG |
| `app/apple-icon.png` | square | 180 | iPhone and iPad home screen (iOS rounds it) |
| `public/brand/icon-192.png`, `icon-512.png` | rounded | 192, 512 | Installing the app (`app/manifest.ts`) |
| `public/brand/icon-maskable-512.png` | square on the frame colour, with room around it | 512 | Android home screen, which crops to its own shape |
| `public/brand/logo-120.png` | square | 120 | Google's OAuth consent screen ("App logo") |
| `public/brand/logo-512.png` | square | 512 | Anywhere else that asks for a square logo |

`app/opengraph-image.png` (and the same `twitter-image.png`) is the card a link to the app shows in chats and on
social sites: the meadow from `public/scenes/meadow/`, the logo, and "Life is short. Look outside.", at 1200×630.

Any SVG renderer will do for the PNGs; these were rendered in Chromium so they match what the browser draws.
