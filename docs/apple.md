# Life is short on iPhone, iPad and Mac

The planner ships as two native apps: one for iPhone and iPad and one for the Mac. They share a bundle id, so they're
one App Store product and one TestFlight listing. Both live in [`apple/`](../apple). This page covers the design, what
the apps do beyond the website, and every step from an empty Apple account to the app on your devices.

- [What the apps add](#what-the-apps-add)
- [How they're built](#how-theyre-built)
- [Why this design](#why-this-design)
- [The bridge](#the-bridge)
- [Widgets](#widgets)
- [Plan](#plan)
- [One-time setup](#one-time-setup)
- [Run it from Xcode](#run-it-from-xcode)
- [Release to TestFlight](#release-to-testflight)
- [App Store review](#app-store-review)
- [Troubleshooting](#troubleshooting)

## What the apps add

The planner itself is the same page you use in the browser, so every feature, fix and redesign lands on the phone, the
tablet and the Mac the moment Vercel deploys it. No app update needed. The apps wrap that page in a native window and add
what a browser can't:

- **Dictation on the device.** The mic uses Apple's speech recogniser, on the device when the language allows. Your
  words stream into the chat bar as you talk, the same as in the browser. It listens in the language picked in
  Settings → Voice, and your names and words (Settings → Voice, your labels, the names in your tasks) go to it as
  contextual strings, so it leans towards them.
- **Siri, Shortcuts and Spotlight.** "Dump a thought in Life is short" opens the chat bar. Say the thought along with
  it and the plan is waiting for you. "Talk to Life is short" opens straight onto the mic, and "Review my week in
  Life is short" opens the review. All three work from the Action button and the Shortcuts app too.
- **Home Screen quick actions.** Press and hold the icon: **Dump a thought** or **Speak**.
- **Widgets on the Home Screen and the lock screen** (iPhone and iPad): the one thing to do now, how long you have for
  it and what comes next, on a ticket over the view out of the train window for the time of day, or in your theme.
  [Widgets](#widgets).
- **Now on the Lock Screen and in the Dynamic Island**: the same answer, pinned as a Live Activity, its slot counting
  down, with Refresh on it. Switched on in Settings → On this iPhone. [Live Activity](#live-activity).
- **A real Mac app.** A menu bar with every command and its shortcut (`⌘K` speak, and again to send; `⇧⌘K`
  dump; `⌘,` settings; `⌘R` reload), a title bar in the planner's colours, and a window that remembers its size and stays signed in when you close
  it.
- **Google sign-in through the system sheet.** Google refuses sign-in inside an app's web view, so **Connect Google**
  opens Apple's secure sign-in sheet and drops you back on Settings → Google accounts.
- **The share sheet** for share links, and **haptics** when you tick something off or apply a plan.
- **Status bar and title bar that follow your theme**, including Night train on a light device.
- **Offline**: a calm "can't reach" screen that retries by itself when the connection comes back.
- **Your own server.** A build can be pinned to your deployment, or ask for its address on first launch, so anyone
  running their own copy can use the same app.

## How they're built

```
apple/
├── project.yml            XcodeGen spec: the iOS app (iPhone + iPad) with its widgets, and the macOS app
├── bootstrap.sh           installs XcodeGen if needed and generates LifeIsShort.xcodeproj
├── Config/                Base.xcconfig (ids, server, version) + your Local.xcconfig
├── Core/                  Swift package, Foundation only, unit-tested: addresses, navigation
│                          rules, deep links, colours, speech transcripts, the widgets' timeline
├── Shared/                both apps: the web view, the bridge, speech, Google sign-in, Siri
│   └── Resources/         Bridge.js (injected into the page), start.html (setup + offline),
│                          the icons, the privacy manifest
├── iOS/                   UIKit, scene-based: window, status bar, quick actions, keyboard,
│                          the App Group hand-off to the widgets, their pictures for CI
├── Widgets/               the widget extension (in the iOS app): Design/ (the views, shared with
│                          the app), Extension/ (the widgets and their timelines), Resources/
│                          (the window's views and Geist)
└── macOS/                 AppKit: window, title bar, menu bar, sandbox entitlements
```

Each app is a thin native shell around a `WKWebView` that loads `https://<your server>/app`:

```
 ┌──────────────── native shell (Swift) ────────────────┐
 │  window · status/title bar · menus · Siri · quick    │
 │  actions · speech · Google sign-in sheet · share     │
 │                    ▲            │                     │
 │      lisNative     │ messages   │ commands            │
 │   (Bridge.js, at   │ from page  ▼ to page             │
 │   document start)  ┌──────────────────────────────┐   │
 │                    │  WKWebView: the planner from │   │
 │                    │  your server (Next.js), same │   │
 │                    │  code as the website         │   │
 │                    └──────────────────────────────┘   │
 └──────────────────────────────────────────────────────┘
```

- **Navigation is locked to the planner.** Only `/app` and Google's callback on your server open inside the app.
  Google's sign-in goes to the system sheet; every other link, including your own home and privacy pages, opens in
  the browser.
- **The page's security doesn't change.** It's still your HTTPS origin with its strict Content-Security-Policy, the
  PIN and authenticator code, and row-level security. Your session lives in the app's own website data store, like a
  browser profile.
- **Edge to edge.** The web view runs under the status bar and home indicator, and the page keeps clear of them with
  `env(safe-area-inset-*)`, as it does when installed to the Home Screen. The laptop layout (an iPad in landscape)
  now does this too.
- **Phone layout on iPhone, laptop layout on iPad and Mac.** The page picks its layout from the window width, as in a
  browser: an iPad in portrait or in Split View gets the phone layout, in landscape the full planner. The iPhone app
  stays upright.

## Why this design

| Option | Verdict |
|---|---|
| **Native Swift shell around the hosted planner** (chosen) | One planner codebase. Real Mac and iPad apps with menus, Siri and native speech. Updates ship with every web deploy. |
| Home Screen web app (already works) | Free, but no App Store or TestFlight, no Siri, no native speech, no menu bar, and Google sign-in can't come back to it. Still a fine fallback. |
| Capacitor | Built for bundled web assets, and its Mac story is iPad-on-Mac. A remote planner plus the native features above would still be mostly custom Swift. |
| Tauri 2 | A real Mac app, but iOS support is young, and every native feature here would be Rust plus Swift plugins, with a Rust toolchain in CI. |
| Mac Catalyst | One UIKit target, but Mac windows, menus and title bars that feel like an iPad. AppKit is a few hundred lines and feels like a Mac app. |
| Rewrite in SwiftUI | Months of work to duplicate a planner that already works, then two codebases to keep in step. |

Loading the hosted page rather than bundling it keeps the server routes (AI sorting, Google, sharing) and the CSP
exactly as they are. The cost is that the planner needs a connection to start, which it needs anyway to reach your
tasks.

## The bridge

`Bridge.js` is injected into the main frame before the page's own scripts. It defines `window.lisNative`, which
`lib/native.ts` wraps for the planner. In a browser it's absent and every call is a no-op.

**Page → app** (`window.webkit.messageHandlers.lis`, answered with a promise):

| Message | What the app does |
|---|---|
| `ready` | The planner is showing: deliver any waiting commands |
| `appearance` | The page's background changed: recolour the status bar, title bar and window |
| `haptic` | A tap of feedback (`success`, `warning`, `error`, `light`, `selection`) |
| `share` | The share sheet, for `navigator.share` |
| `speech.*` | Start, stop or abort native dictation (behind `SpeechRecognition`) |
| `external.open` | Open a link in the browser |
| `widget` | Today's picture for the widgets ([Widgets](#widgets)); with no snapshot, empty them (signed out) |
| `liveActivity` | The Lock Screen's Now settings (`on`, `hideTitles`, `style`), any to change; answered with how it stands ([Live Activity](#live-activity)) |
| `server.set`, `page.retry` | Only from the app's own setup and offline page |

`lisNative` also says what the app can do: `platform`, `version`, `build`, `passkeys` when the app is linked to
the site it's showing ([Passkeys in the apps](#passkeys-in-the-apps)), and `liveActivity` when it offers the Lock
Screen's Now (an iPhone, or an iPad that allows Live Activities).

**App → page**: commands from Siri, quick actions, `lifeisshort://` links and the Mac menu: `dump` (with optional
text), `listen`, `open` (`settings`, `analytics`, `review`, `share`), `task` (open a task tapped on a widget). They
wait in the app until the planner says
`ready`, so a quick action that launches the app lands once you've unlocked it.

Native dictation stands in for the browser's `SpeechRecognition`, so `useVoice` in `components/hooks.ts` runs
unchanged. Its `phrases` (as `SpeechRecognitionPhrase`, which the bridge defines, or plain strings) reach the app in
`speech.start` and become the request's `contextualStrings`: up to 100, each up to 100 characters. The app answers only the planner's own origin and its bundled pages, only in the main frame. Any other origin
gets nothing, and the page can't navigate anywhere else inside the app.

**Links the apps understand:** `lifeisshort://dump?text=…`, `lifeisshort://listen`, `lifeisshort://settings`,
`lifeisshort://analytics`, `lifeisshort://review`, `lifeisshort://share` and `lifeisshort://task/<id>`.

## Widgets

**Now**, on the Home Screen (small, medium and large) and the lock screen (rectangular, round and inline), on iPhone
and iPad. Each shows the one thing to do now and how long you have for it, the planner's own answer
(`components/Next.tsx`): the task on the calendar this minute, until it ends, or the top of the backlog, free until the
next thing. Tap it and the app opens on that task.

| Size | What's on it |
|---|---|
| Small | Now, when it ends (or how long it takes), its goal, and what's left of its slot draining away |
| Medium | The same on a ticket, and what's next with its time |
| Large | Now, written on the sky, over a ticket: today's outcomes and their steps (or **Plan it with Claude**, while today isn't planned), and the rest of today like a departures board |
| Lock screen | The task and the time it ends, with what's left of its slot as a bar or a gauge |

**Two looks**, picked in the widget's **Edit Widget** menu:

- **The window** (the default): the view out of the train for the time of day, from the home page's scenes
  (`public/scenes`): amber at dawn, the meadow by day (hot-air balloons at the weekend), amber again at dusk and night
  after eight. The task is printed on the home page's ticket. With nothing to do, it's just the view.
- **Your theme**: Tide or Day train, and Night train when the phone is in dark mode, with your accent. The tinted and
  clear Home Screens and StandBy draw it in their own colours.

**How it stays right.** Whenever your day changes, the planner hands the app a small picture of it (`lib/widget.ts`):
what's on the calendar from an hour ago to the end of tomorrow, the top of the backlog in the order Now picks from,
today's outcomes and counts, and how the planner looks. The app keeps it in an App Group the widgets can read
(`group.<bundle id>`, `iOS/WidgetBridge.swift`) and asks them to redraw, only when it changed. Each widget works out
Now and Next from it for any moment, by the planner's own rules, a missed slot going back to the backlog after its hour
included (`WidgetTimeline` in the Swift core, tested), and lines up an entry at every moment that changes what it
shows. So it stays right while the app is closed, until something changes elsewhere: a task added on the laptop
reaches the widget the next time the app is open. If the app hasn't been open for a day and a half, the widget says
when it last heard. Signing out empties it.

**Privacy.** Today's picture stays on the device, in the App Group. Titles are marked private, so a locked phone hides
them on the lock screen.

**The art.** The window's views are the home page's SVG scenes drawn to JPEG for each widget size at 2x and 3x
(`node apple/scripts/scenes.mjs`), since iOS can't draw their blur filters and WidgetKit refuses pictures much bigger
than the widget. The type is Geist and Geist Mono, as in the planner (SIL Open Font License, in
`Widgets/Resources/Fonts/OFL.txt`).

**Seeing them without a phone.** CI's smoke test has the app draw every widget, in both looks, at each time of day,
empty, tinted and on the lock screen (`iOS/WidgetGallery.swift`). The pictures are in the run's **smoke-test**
artifact as `widgets-*.png`.

## Live Activity

**Now on the Lock Screen and in the Dynamic Island** (iPhone; an iPad shows it on its Lock Screen). The same answer as
the Now widget, pinned: the task on the calendar this minute and its slot counting down, or the top of the backlog and
how long you're free, and what comes next. Tap it and the app opens on that task. Off until you switch it on in
**Settings → On this iPhone**, which also picks its look (**the window** or **your theme**, as on the widget) and can
**hide task names** (it keeps the goal colours and times, and leaves the names out of what it carries at all).

| Where | What's on it |
|---|---|
| Lock Screen, Notification Centre, StandBy | The window: the clock on the glass (time left, or when free time ends) and the task on a ticket, what's next below the tear. Your theme: the planner's Now card, small. Refresh on both. |
| Dynamic Island, compact | The slot as a ring draining round its goal's colour (the lamp in free time, a white ring in a meeting, a tick when it's all clear), and the minutes left. |
| Dynamic Island, minimal | The ring alone, beside another app's activity. |
| Dynamic Island, expanded | What it is and how long, the big clock, and the task with its goal, today's steps for that goal, what's next and Refresh. |
| Apple Watch, CarPlay, the Mac's menu bar | The compact views, by iOS's own choice. |

**How it stays right without push.** The app is signed without the Push Notifications capability (a free Apple ID
can't have it), so nothing on a server can change the activity: only the app can, while it runs. So:

1. **The planner hands it every change.** The `widget` message (`lib/widget.ts`) reaches the activity too
   (`iOS/WidgetBridge.swift` → `NowActivityController`), as does the app coming to the front and leaving it, and the
   clock (midnight, a new time zone). While the planner is open it turns on time.
2. **Two steps in every update.** Each update carries what's Now and what Now becomes at the next moment that changes
   it (`LiveNowState.then`, worked out by the widgets' own rules in `LiveNow.swift`, tested). That moment is the
   activity's stale date: there iOS redraws it with the second step, a minute or two late, with nothing running.
   Countdowns and bars run by themselves within a step.
3. **Past that, it says so.** Out of date, the lamp goes out, the clock counts up from when things changed, the ticket
   reads **Probably now** and **Refresh** grows big. "As of 10:48" says when the planner last spoke.
4. **Refresh on it** brings it up to date without opening the app: it's a `LiveActivityIntent`, which iOS runs in the
   app's process in the background (`Widgets/Live/NowActivity.swift`). It reads the day the planner last handed over
   from the App Group.
5. **Show Now** does the same from anywhere: the **Show now** button in the planner's Settings → On this iPhone,
   Shortcuts, Siri ("Show now in Life is short"), the Action button, or on iOS 18 a control in Control Center or the
   Lock Screen's corners. It always puts up a fresh activity, even outside your day's hours or after a swipe-away, and
   that one stays up until iOS ends it.

A task added on the laptop reaches it the next time the app runs, as with the widgets.

**Its limits, and what it does about them.**

- **Eight hours.** iOS ends a Live Activity after 8 hours (it stays on the Lock Screen up to 4 more). Opening the
  planner swaps in a fresh one once the running one is 3 hours old and wouldn't last the day; Refresh does when it has
  less than an hour left. It runs only in your day's hours (Settings → Calendar), unless you asked for it with Show
  Now, and leaves a last word, "That's the day", for half an hour after they end.
- **Started only from the app on screen, or an intent.** iOS allows nothing else, so it starts when the planner opens
  with a fresh day, from Refresh or from Show Now; anything else only updates it.
- **4 KB.** Everything it carries fits in about 1.6 KB at the most, with titles cut by bytes (`LiveNow.fit`, tested).
- **Swiped away** stays away for the rest of that day, unless you ask for it with Show Now or switch it on again.
- **Signed out, or another server**: it ends at once, with the widgets.
- **A reinstall** (every 7 days on a free Apple ID): the first launch of a new install ends the old activity, which iOS
  would draw blank on the Lock Screen, and starts afresh once the planner speaks. Builds from Xcode all say build 1, so
  an install is told apart by when its binary was made.

**Keep it fresh with no taps:** in Shortcuts → Automation, add a **Time of Day** automation (say 8:55, 12:55 and 16:55)
that runs **Show Now on the Lock Screen**, set to run immediately. It brings it up to date, and back if it ran out.

**Seeing it without a phone.** CI's smoke test draws every state, in both looks, on the Lock Screen and in the Dynamic
Island (`widgets-live.png` and `widgets-island.png`, `iOS/WidgetGallery.swift`).

## Plan

**Phase 1: the apps (this change)**

- [x] Swift core package with unit tests: server addresses, navigation rules, deep links, colours, speech transcripts
- [x] iPhone + iPad app (UIKit, scenes): edge to edge, status bar from the page, quick actions, keyboard shortcuts
- [x] Mac app (AppKit): window, title bar from the page, full menu bar, sandbox, file import
- [x] Bridge: commands, appearance, haptics, share sheet, native dictation, links
- [x] Google sign-in via `ASWebAuthenticationSession`, with the callback page handing the answer back
- [x] Setup and offline page, bundled in the app
- [x] Siri, Shortcuts and Spotlight (App Intents), Home Screen quick actions
- [x] Web: `lib/native.ts`, native commands in the planner, iPad safe areas, haptics
- [x] App icons from the brand logo, privacy manifest, export compliance
- [x] CI: unit tests, both apps built, and a smoke test that runs each app against a local copy of the planner and
  screenshots it (iPhone, iPad, Mac)
- [x] Release workflow: archive, sign with Apple's cloud signing, upload to TestFlight

**Phase 2: the planner outside the app**

- [x] **Widgets** on the Home Screen and the lock screen, on iPhone and iPad: the Next task and how long you have for
  it ([Widgets](#widgets)). Still to come: the Mac desktop, and Done from the widget without opening the app.
- [x] **Now on the Lock Screen and in the Dynamic Island**, a Live Activity, with Refresh and Show Now
  ([Live Activity](#live-activity)). Still to come: a refresh in the background when iOS allows one, a scheduled start
  each morning (iOS 26), and, with the paid program, push from the server at every slot.
- **A nudge when a slot starts**: local notifications for the next day's scheduled tasks, set from the planner, so
  there's no push server.
- [x] **Face ID** in place of the PIN and the code: done as **passkeys**, on the website and in the apps
  ([Passkeys in the apps](#passkeys-in-the-apps)), rather than a PIN kept in the Keychain.
- **Share extension**: send text or a link from any app into a dump.
- [x] **Password AutoFill** for the first sign-in: the same `apple-app-site-association` file and webcredentials
  link that passkeys use.

**Phase 3: App Store**, if you want strangers to install it: the first-launch server screen already exists. It needs a
demo server and account for App Review, screenshots, and the privacy label below.

## One-time setup

You need a Mac with Xcode 26 or later for local builds. Releases build on GitHub's Macs, so after this setup you never
need Xcode to ship.

1. **Apple Developer Program** ($99 a year): [developer.apple.com/programs](https://developer.apple.com/programs/).
   Note your **Team ID** (Membership details).
2. **Pick a bundle id** you own, in reverse-DNS form. The default is `io.github.abhinav-adtechs.lifeisshort`. To use
   another, change `LIS_BUNDLE_ID` in `apple/Config/Base.xcconfig`. Register it at
   [Certificates, Identifiers & Profiles → Identifiers](https://developer.apple.com/account/resources/identifiers/list)
   → **+** → App IDs → App. Tick **App Groups** (step 3), and **Associated Domains** if you'll use passkeys in the
   apps; nothing else.
3. **The App Group for the widgets.** Identifiers → **+** → App Groups → `group.<your bundle id>` (for the default,
   `group.io.github.abhinav-adtechs.lifeisshort`). Then open your bundle id's identifier, tick **App Groups**, choose
   the group, and save. Register the widgets too: **+** → App IDs → App → `<your bundle id>.widgets`, with **App
   Groups** ticked and the same group. Both have to be in place before the first release with widgets, or the export
   fails on the App Group.
4. **Create the app** in [App Store Connect](https://appstoreconnect.apple.com) → Apps → **+** → New App. Tick
   **iOS** and **macOS**, pick the bundle id, and give it a name. App names are unique across the whole App Store,
   so if "Life is short" is taken use something like "Life is short: Planner". The name on the Home Screen stays
   "Life is short".
5. **Create an API key**: App Store Connect → Users and Access → Integrations → **Team Keys** → **+**, access
   **Admin** (Apple's cloud signing needs Admin). Download the `.p8` (you only get one chance) and note the **Key ID**
   and the **Issuer ID** above the list.
6. **GitHub**: repo → Settings → Secrets and variables → Actions.
   - Secrets: `ASC_KEY_ID`, `ASC_ISSUER_ID`, and `ASC_KEY_P8` (the whole `.p8` file, its BEGIN
     and END lines included).
   - Variables: `APPLE_TEAM_ID` (your Team ID), `LIS_SERVER` (your deployment's host, like
     `life-is-short.vercel.app`) and, if you changed it, `LIS_BUNDLE_ID`. `LIS_PASSKEYS` = `1` once passkeys in the
     apps are set up ([Passkeys in the apps](#passkeys-in-the-apps)).
7. **Google** needs nothing new. The app uses the same `https://<your server>/google/callback` redirect as the website.

## Passkeys in the apps

Passkeys work on the planner's website as soon as they're on in Supabase
([setup.md → Passkeys](setup.md#7-passkeys-optional-face-id-touch-id-windows-hello)). Inside the apps, WebKit only
allows a passkey for a site the app is linked to, in both directions:

1. **The site lists the app.** The planner serves `/.well-known/apple-app-site-association` once Vercel has
   `APPLE_TEAM_ID` (and `LIS_BUNDLE_ID`, if you changed it); redeploy after adding it. Open
   `https://<your server>/.well-known/apple-app-site-association` and check it shows `<Team ID>.<bundle id>`. Apple's
   CDN fetches it, so a change can take a day to reach devices.
2. **The app names the site.** Certificates, Identifiers & Profiles → Identifiers → your bundle id → tick
   **Associated Domains** → Save. Then set the GitHub variable `LIS_PASSKEYS` to `1`. The next Apple release signs both
   apps with `webcredentials:<LIS_SERVER>` and tells the planner passkeys work there (`lisNative.passkeys`).

Until both are in place the apps don't offer passkeys, and Settings → Account says why; the PIN and code work as
before. A passkey made on the website works in the apps and the other way round: it's the same site. The link also
lets the apps fill in the password you saved for the site.

Running from Xcode, add the Associated Domains capability with `webcredentials:<your host>` to the target and set
`LIS_PASSKEYS = YES` in `Local.xcconfig`. CI's builds stay unlinked, because macOS won't launch an app signed ad hoc
with Associated Domains; CI only checks the release signing adds it.

## Run it from Xcode

```sh
cd apple
./bootstrap.sh            # installs XcodeGen with Homebrew if needed, writes Config/Local.xcconfig, generates the project
open LifeIsShort.xcodeproj
```

In `Config/Local.xcconfig`, set `DEVELOPMENT_TEAM` to your Team ID and `LIS_SERVER` to your deployment's host. Pick the
**LifeIsShort-iOS** or **LifeIsShort-macOS** scheme and run.

- Against `npm run dev` on the same Mac: `LIS_SERVER = localhost:3000`. Plain http is allowed for this machine and
  the local network only.
- Leave `LIS_SERVER` empty and the app asks for an address on first launch. To change it later, use the offline
  screen, or **Life is short → Change Server…** on the Mac.
- `-LISServerURL <address>` in the scheme's launch arguments overrides everything.
- Debug builds can be inspected from Safari → Develop → your device or Mac → Life is short.
- The widgets come with the iOS app. Run it, open the planner once, then add **Now** from the Home Screen's widget
  gallery. Xcode signs the App Group with your team on its own. **Release to TestFlight** below puts them on your phone
  without Xcode.
- The Lock Screen's Now comes with it too, and works with a free Apple ID: it needs no capability beyond the App Group.
  Switch it on in the planner's Settings → On this iPhone.
- Core logic tests: `swift test --package-path apple/Core`.
- `project.yml` is the source of truth. The `.xcodeproj` is generated and ignored, so after pulling, run
  `./bootstrap.sh` again.

## Release to TestFlight

Actions → **Apple release** → Run workflow (choose iOS, macOS or both). About 15 minutes later the build is in App Store
Connect → TestFlight.

The first time, in TestFlight: add yourself under **Internal Testing** (a group with you in it, set to add builds
automatically). Install **TestFlight** from the App Store on the iPhone, iPad and Mac, sign in with the same Apple ID,
and install Life is short. Internal builds need no review and last 90 days, so run the workflow again for a fresh one.
TestFlight updates the app on every device.

What the workflow does:

1. Archives each app with signing switched off, then signs the archive ad hoc with its entitlements
   (`apple/scripts/adhoc-sign.sh`). Apple's API keys can sign an export but not an archive, and an unsigned archive
   would lose the Mac app's sandbox entitlements.
2. Exports with **cloud signing** (`-allowProvisioningUpdates` and the API key). Apple holds the distribution
   certificate, so there's no `.p12` to keep, rotate or leak.
3. Uploads straight to App Store Connect. The build number is the workflow's run number, and the version is
   `MARKETING_VERSION` in `Base.xcconfig`.

Tagging a commit `apple-v1.2.0` runs it too.

## App Store review

TestFlight for yourself and up to 100 people on your team needs none of this. For the public App Store:

- **Minimum functionality (4.2)**: the native dictation, Siri and Shortcuts, quick actions, Mac menu bar and system
  sign-in sheet are what make this an app and not a website. Mention them in the review notes.
- **Sign-in**: give App Review a demo server and an account with its PIN and authenticator secret, since the app has
  no sign-up by design. Sign in with Apple isn't required: the app has no third-party sign-in for your account (Google
  is only for reading calendars).
- **Account deletion** isn't required either: there's no account creation in the app.
- **Privacy label**: the planner sends your tasks, your settings and what you dictate (as text) to *your* server. The
  app collects nothing for the developer, so in Apple's terms it's "Data Not Collected" when you run your own server.
  Dictated audio goes to Apple only when on-device recognition isn't available for the language. The privacy policy
  is `https://<your server>/privacy`.
- **Export compliance**: `ITSAppUsesNonExemptEncryption` is `NO` (only HTTPS), so App Store Connect doesn't ask.

## Troubleshooting

- **"Cloud signing permission error"**: the API key needs **Admin** access.
- **"No profiles for … were found"** or an unknown bundle id: register the bundle id (step 2) and create the app record
  (step 4) before the first release.
- **The export fails on `com.apple.security.application-groups`**, or a profile "doesn't include the App Groups
  capability": register the App Group and the widgets' identifier, and tick App Groups on both (step 3).
- **A widget says "Open Life is short"**: it hasn't heard from the planner yet. Open the app once, signed in. A build
  that isn't signed with the App Group (CI's Simulator builds) never hands anything over.
- **Now isn't on the Lock Screen**: check Settings → On this iPhone in the planner, then the iPhone's Settings → Life is
  short → Live Activities. It starts once the planner opens with today, within your day's hours, and stays away for the
  rest of a day you swiped it away (Show Now brings it back).
- **The Lock Screen's Now is blank after a reinstall**: tap **Show now** in Settings → On this iPhone. If it's still
  blank, restart the iPhone. iOS sometimes loses track of a new build's
  views until it restarts.
- **The mic does nothing**: Settings → Privacy & Security → Microphone and Speech Recognition → Life is short.
- **Google says "disallowed_useragent"**: the app is out of date (Connect Google must open the system sheet). Update
  from TestFlight.
- **No passkey button in the app**: check both halves of [Passkeys in the apps](#passkeys-in-the-apps): the
  association file names your Team ID and bundle id, and the build came from a release with `LIS_PASSKEYS` = `1`.
  An app pointed at another server (Change Server…) isn't linked to it.
- **Blank or stuck on the offline screen**: check `LIS_SERVER` in the build (Actions variables or
  `Local.xcconfig`). The Mac's **Change Server…** and the offline screen's link take a new address without
  rebuilding.
