#!/bin/bash
# Signs an unsigned archive ad hoc, with the app's entitlements, ready for `xcodebuild -exportArchive` to sign it for
# the App Store with Apple's cloud signing (.github/workflows/apple-release.yml). App Store Connect API keys can sign
# an export but not an archive, so the archive is built unsigned; but an unsigned archive carries no entitlements, and
# the Mac app would lose its sandbox on export. Signing it here, ad hoc, gives the export entitlements to carry over.
#
# Usage: apple/scripts/adhoc-sign.sh <.xcarchive> ios|macos <team id> <bundle id>
set -euo pipefail

ARCHIVE=$1 PLATFORM=$2 TEAM=$3 BUNDLE=$4
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
    ;;
  *)
    echo "Platform is ios or macos, not $PLATFORM" >&2
    exit 1
    ;;
esac
/usr/libexec/PlistBuddy -c "Add :com.apple.developer.team-identifier string $TEAM" "$ENTITLEMENTS"

# Anything nested first (none today: the Swift package is linked in statically), then the app.
find "$APP" -depth -mindepth 1 \( -name '*.framework' -o -name '*.dylib' -o -name '*.appex' \) -print0 |
  while IFS= read -r -d '' nested; do codesign --force --sign - --timestamp=none "$nested"; done
if [ "$PLATFORM" = macos ]; then
  # The Mac app keeps the hardened runtime it was built with.
  codesign --force --sign - --timestamp=none --options runtime --entitlements "$ENTITLEMENTS" "$APP"
else
  codesign --force --sign - --timestamp=none --entitlements "$ENTITLEMENTS" "$APP"
fi

codesign --verify --deep --strict "$APP"
echo "Signed $(basename "$APP") ad hoc with:"
codesign -d --entitlements - --xml "$APP" | plutil -p -
