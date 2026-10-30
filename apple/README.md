# Life is short for iPhone, iPad and Mac

Native shells around the planner: a UIKit app for iPhone and iPad and an AppKit app for the Mac, sharing one bundle id.
The design, the one-time Apple setup and the release steps are in [`docs/apple.md`](../docs/apple.md).

```sh
./bootstrap.sh                        # XcodeGen → LifeIsShort.xcodeproj (needs Homebrew or XcodeGen)
open LifeIsShort.xcodeproj            # schemes: LifeIsShort-iOS, LifeIsShort-macOS
swift test --package-path Core        # the logic tests, no Xcode needed
node scripts/icons.mjs                # redraw the app icons from public/brand (run from the repo root)
```

| Path | What's there |
|---|---|
| `project.yml` | Both targets. The `.xcodeproj` is generated from it and not committed. |
| `Config/` | `Base.xcconfig`: bundle id, server, version, team. Your `Local.xcconfig` overrides it. |
| `Core/` | Swift package, Foundation only: server addresses, which pages stay in the window, `lifeisshort://` links, the page's messages, colours, speech transcripts. |
| `Shared/` | Both apps: `WebController` (the web view and the bridge), `SpeechBridge`, `GoogleSignIn`, Siri intents, the CI smoke test. |
| `Shared/Resources/` | `Bridge.js` (injected into the page as `window.lisNative`), `Pages/start.html` (setup and offline), icons, privacy manifest. |
| `iOS/`, `macOS/` | Each platform's window, Info.plist and, on the Mac, the menu bar and sandbox entitlements. |
| `scripts/` | `smoke.sh` (CI runs each app against a local planner and screenshots it), `adhoc-sign.sh` (release signing), `icons.mjs`. |
