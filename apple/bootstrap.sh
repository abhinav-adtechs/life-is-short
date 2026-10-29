#!/bin/sh
# Generates LifeIsShort.xcodeproj from project.yml, installing XcodeGen with Homebrew if it's missing.
# Run it again after pulling changes to project.yml.
set -eu
cd "$(dirname "$0")"

if ! command -v xcodegen >/dev/null 2>&1; then
  if ! command -v brew >/dev/null 2>&1; then
    echo "XcodeGen is needed: brew install xcodegen, or see https://github.com/yonaskolb/XcodeGen" >&2
    exit 1
  fi
  brew install xcodegen
fi

[ -f Config/Local.xcconfig ] || cp Config/Local.xcconfig.example Config/Local.xcconfig
xcodegen generate --spec project.yml
echo "Done. Set DEVELOPMENT_TEAM and LIS_SERVER in apple/Config/Local.xcconfig, then: open apple/LifeIsShort.xcodeproj"
