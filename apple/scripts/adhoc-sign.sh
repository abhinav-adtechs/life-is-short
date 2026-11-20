#!/bin/bash
# Signs an unsigned archive ad hoc, with the app's entitlements, ready for `xcodebuild -exportArchive` to sign it for
# the App Store with Apple's cloud signing (.github/workflows/apple-release.yml). App Store Connect API keys can sign
# an export but not an archive, so the archive is built unsigned; but an unsigned archive carries no entitlements, and
# the Mac app would lose its sandbox on export. Signing it here, ad hoc, gives the export entitlements to carry over.
#
# Usage: apple/scripts/adhoc-sign.sh <.xcarchive> ios|macos <team id> <bundle id> [<webcredentials host>]
# The host links the app to the planner's site for passkeys (docs/apple.md → Passkeys in the apps). The App ID needs the
# Associated Domains capability for the export to keep it.
# On iOS the app and its widgets (PlugIns/*.appex) share the App Group group.<bundle id>, where the app keeps today's
# picture for them (docs/apple.md → Widgets); both App IDs need the App Groups capability with it.
set -euo pipefail

ARCHIVE=$1 PLATFORM=$2 TEAM=$3 BUNDLE=$4 WEBCREDENTIALS=${5:-}
HERE=$(cd "$(dirname "$0")" && pwd)
APP=$(find "$ARCHIVE/Products/Applications" -maxdepth 1 -name '*.app' -print -quit)
[ -n "$APP" ] || { echo "No app in $ARCHIVE" >&2; exit 1; }

ENTITLEMENTS="$(mktemp -d)/app.entitlements"
case $PLATFORM in
  macos)
    cp "$HERE/../macOS/LifeIsShort.entitlements" "$ENTITLEMENTS"
    /usr/libexec/PlistBuddy -c "Add :com.apple.application-identifier string $TEAM.$BUNDLE" "$ENTITLEMENTS"
    ;;
  ios)
    plutil -create xml1 "$ENTITLEMENTS"
    /usr/libexec/PlistBuddy -c "Add :application-identifier string $TEAM.$BUNDLE" "$ENTITLEMENTS"
    /usr/libexec/PlistBuddy -c "Add :com.apple.security.application-groups array" \
      -c "Add :com.apple.security.application-groups:0 string group.$BUNDLE" "$ENTITLEMENTS"
    ;;
  *)
    echo "Platform is ios or macos, not $PLATFORM" >&2
    exit 1
    ;;
esac
/usr/libexec/PlistBuddy -c "Add :com.apple.developer.team-identifier string $TEAM" "$ENTITLEMENTS"
if [ -n "$WEBCREDENTIALS" ]; then
  /usr/libexec/PlistBuddy -c "Add :com.apple.developer.associated-domains array" \
    -c "Add :com.apple.developer.associated-domains:0 string webcredentials:$WEBCREDENTIALS" "$ENTITLEMENTS"
fi

# Anything nested first (no frameworks today: the Swift package is linked in statically), then the widgets, each with
# its own App ID and the App Group, then the app.
find "$APP" -depth -mindepth 1 \( -name '*.framework' -o -name '*.dylib' \) -print0 |
  while IFS= read -r -d '' nested; do codesign --force --sign - --timestamp=none "$nested"; done
for appex in "$APP"/PlugIns/*.appex; do
  [ -d "$appex" ] || continue
  id=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$appex/Info.plist")
  ext="$(mktemp -d)/appex.entitlements"
  plutil -create xml1 "$ext"
  /usr/libexec/PlistBuddy -c "Add :application-identifier string $TEAM.$id" -c "Add :com.apple.developer.team-identifier string $TEAM" \
    -c "Add :com.apple.security.application-groups array" -c "Add :com.apple.security.application-groups:0 string group.$BUNDLE" "$ext"
  codesign --force --sign - --timestamp=none --entitlements "$ext" "$appex"
  echo "Signed $(basename "$appex") ad hoc with:"
  codesign -d --entitlements - --xml "$appex" | plutil -p -
done
if [ "$PLATFORM" = macos ]; then
  # The Mac app keeps the hardened runtime it was built with.
  codesign --force --sign - --timestamp=none --options runtime --entitlements "$ENTITLEMENTS" "$APP"
else
  codesign --force --sign - --timestamp=none --entitlements "$ENTITLEMENTS" "$APP"
fi

codesign --verify --deep --strict "$APP"
echo "Signed $(basename "$APP") ad hoc with:"
codesign -d --entitlements - --xml "$APP" | plutil -p -
