# Life is short for iPhone, iPad and Mac

Native shells around the planner: a UIKit app for iPhone and iPad, with Home Screen and lock screen widgets, and an
AppKit app for the Mac, sharing one bundle id.
The design, the one-time Apple setup and the release steps are in [`docs/apple.md`](../docs/apple.md).

```sh
./bootstrap.sh                        # XcodeGen → LifeIsShort.xcodeproj (needs Homebrew or XcodeGen)
open LifeIsShort.xcodeproj            # schemes: LifeIsShort-iOS, LifeIsShort-macOS
swift test --package-path Core        # the logic tests, no Xcode needed
node scripts/icons.mjs                # redraw the app icons from public/brand (run from the repo root)
node scripts/scenes.mjs               # redraw the widgets' window views from public/scenes (run from the repo root)
```

| Path | What's there |
|---|---|
| `project.yml` | Both targets. The `.xcodeproj` is generated from it and not committed. |
| `Config/` | `Base.xcconfig`: bundle id, server, version, team. Your `Local.xcconfig` overrides it. |
| `Core/` | Swift package, Foundation only: server addresses, which pages stay in the window, `lifeisshort://` links, the page's messages, colours, speech transcripts, and the widgets' snapshot and timeline (what to show when). |
| `Shared/` | Both apps: `WebController` (the web view and the bridge), `SpeechBridge`, `GoogleSignIn`, Siri intents, the CI smoke test. |
| `Shared/Resources/` | `Bridge.js` (injected into the page as `window.lisNative`), `Pages/start.html` (setup and offline), icons, privacy manifest. |
| `iOS/`, `macOS/` | Each platform's window, Info.plist and entitlements, and on the Mac the menu bar. On iOS, `WidgetBridge` keeps today's picture for the widgets and `WidgetGallery` draws them for CI. |
| `Widgets/` | The widgets ([docs/apple.md → Widgets](../docs/apple.md#widgets)): `Design/` (the views, shared with the app), `Extension/` (the widgets and their timelines), `Resources/` (the window's views, Geist). |
| `scripts/` | `smoke.sh` (CI runs each app against a local planner and screenshots it and every widget), `adhoc-sign.sh` (release signing), `icons.mjs`, `scenes.mjs`. |
