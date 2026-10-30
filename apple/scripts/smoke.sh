#!/bin/bash
# CI's smoke test (.github/workflows/apple.yml). Runs each built app against the planner on $SMOKE_SERVER (npm start
# with no Supabase, so it runs on the browser's own storage). An app passes when its SmokeTest (Shared/SmokeTest.swift)
# says so: the planner loaded, said `ready` through the bridge and answered a `ping`. Logs and snapshots go to <out dir>.
#
# Usage: apple/scripts/smoke.sh <derived data> <out dir> mac|iphone|ipad ...
set -uo pipefail

DD=$1 OUT=$2
shift 2
SERVER=${SMOKE_SERVER:-http://localhost:3000}
mkdir -p "$OUT"
failed=0

# Runs a command with its output in a log, killing it after a number of seconds.
run() {
  local seconds=$1 log=$2
  shift 2
  "$@" >"$log" 2>&1 &
  local pid=$!
  (sleep "$seconds" && kill -9 "$pid" 2>/dev/null && echo "LIS-SMOKE killed after ${seconds}s" >>"$log") &
  local watchdog=$!
  wait "$pid"
  kill "$watchdog" 2>/dev/null
  wait "$watchdog" 2>/dev/null
  return 0
}

# Reads what the app said, keeps its snapshot, and records a pass or a failure.
verdict() {
  local name=$1 log=$2 shot
  grep -E "LIS-(SMOKE|PAGE)" "$log" | tr -d '\r' | sed 's/^/  /'
  shot=$(tr -d '\r' <"$log" | sed -n 's/^.*LIS-SMOKE shot //p' | tail -1)
  if [ -n "$shot" ] && [ -f "$shot" ]; then cp "$shot" "$OUT/$name.png"; fi
  if grep -q "LIS-SMOKE pass" "$log"; then
    echo "✓ $name"
  else
    echo "✗ $name: the planner never came up through the bridge. The end of its log:"
    tail -n 60 "$log"
    failed=1
  fi
}

# The newest available simulator of a kind: an iPhone Pro, or a 13-inch iPad Pro (the laptop layout).
simulator() {
  xcrun simctl list devices available -j | python3 -c '
import json, re, sys
kind = sys.argv[1]
best = None
for runtime, devices in json.load(sys.stdin)["devices"].items():
    m = re.search(r"iOS-(\d+)-(\d+)", runtime)
    if not m:
        continue
    version = (int(m.group(1)), int(m.group(2)))
    for d in devices:
        name = d["name"]
        if kind == "iphone":
            rank = 2 if name.startswith("iPhone") and "Pro" in name and "Max" not in name else 1 if name.startswith("iPhone") else 0
        else:
            rank = 2 if name.startswith("iPad Pro") and "13" in name else 1 if name.startswith("iPad") else 0
        if rank and (best is None or (rank, version) > best[0]):
            best = ((rank, version), d["udid"], name)
if not best:
    sys.exit("No " + kind + " simulator is installed")
print(best[1])
print(best[2], file=sys.stderr)' "$1"
}

for target in "$@"; do
  case $target in
    mac)
      app="$DD/Build/Products/Debug/Life is short.app"
      run 180 "$OUT/mac.log" "$app/Contents/MacOS/Life is short" -LISSmokeTest YES -LISServerURL "$SERVER" -LISSmokeShot mac.png
      verdict mac "$OUT/mac.log"
      ;;
    iphone | ipad)
      app="$DD/Build/Products/Debug-iphonesimulator/Life is short.app"
      bundle=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app/Info.plist")
      if ! udid=$(simulator "$target"); then failed=1; continue; fi
      xcrun simctl bootstatus "$udid" -b >/dev/null
      xcrun simctl install "$udid" "$app"
      run 300 "$OUT/$target.log" xcrun simctl launch --console-pty --terminate-running-process "$udid" "$bundle" \
        -LISSmokeTest YES -LISServerURL "$SERVER" -LISSmokeShot "$target.png"
      verdict "$target" "$OUT/$target.log"
      xcrun simctl shutdown "$udid" >/dev/null 2>&1 || true
      ;;
    *)
      echo "Unknown target $target (mac, iphone or ipad)" >&2
      failed=1
      ;;
  esac
done
exit $failed
