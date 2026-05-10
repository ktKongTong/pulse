#!/bin/zsh
# Diagnostic — run the unsigned binary directly to capture stderr after
# launch. Kills any prior copy first.
set -u
pkill -9 -f '/PulseBarNative.app/Contents/MacOS/PulseBarNative' 2>/dev/null || true
sleep 1
APP=/Users/kt/Documents/Playground/pulse/macosApp/.xcode-derived/Build/Products/Debug/PulseBarNative.app/Contents/MacOS/PulseBarNative
OUT=/tmp/pulse-stdout.log
ERR=/tmp/pulse-stderr.log
: > "$OUT"
: > "$ERR"
nohup "$APP" > "$OUT" 2> "$ERR" < /dev/null &
APPPID=$!
disown 2>/dev/null || true
sleep 10
if kill -0 "$APPPID" 2>/dev/null; then
  echo "ALIVE pid=$APPPID"
  kill "$APPPID" 2>/dev/null || true
else
  echo "DEAD pid=$APPPID"
fi
echo "--- stdout ---"
cat "$OUT"
echo "--- stderr (tail 60) ---"
tail -60 "$ERR"
