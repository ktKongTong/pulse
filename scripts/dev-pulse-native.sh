#!/bin/zsh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DERIVED="$ROOT/macosApp/.xcode-derived"
PRODUCTS="$DERIVED/Build/Products/Debug"
APP="$PRODUCTS/PulseBarNative.app"
EXECUTABLE="$APP/Contents/MacOS/PulseBarNative"
ENTITLEMENTS="$ROOT/macosApp/PulseBarNative/PulseBarNative.entitlements"
SHARED_LIB="$PRODUCTS/libPulseBarShared.a"

if [[ ! -f "$SHARED_LIB" ]]; then
  echo "Missing shared export library: $SHARED_LIB" >&2
  exit 1
fi

mkdir -p "$APP/Contents/MacOS"

cat > "$APP/Contents/Info.plist" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleDevelopmentRegion</key>
	<string>en</string>
	<key>CFBundleExecutable</key>
	<string>PulseBarNative</string>
	<key>CFBundleIdentifier</key>
	<string>io.github.kt.pulsebar.native</string>
	<key>CFBundleInfoDictionaryVersion</key>
	<string>6.0</string>
	<key>CFBundleName</key>
	<string>PulseBarNative</string>
	<key>CFBundlePackageType</key>
	<string>APPL</string>
	<key>CFBundleShortVersionString</key>
	<string>1.0</string>
	<key>CFBundleVersion</key>
	<string>1</string>
	<key>LSUIElement</key>
	<true/>
	<key>NSAppleEventsUsageDescription</key>
	<string>PulseBar reads browser and Spotify metadata to show the current status in the menu bar.</string>
</dict>
</plist>
EOF

printf 'APPL????' > "$APP/Contents/PkgInfo"

swiftc \
  "$ROOT"/macosApp/PulseBarNative/*.swift \
  -I "$PRODUCTS" \
  -F "$PRODUCTS" \
  -L "$PRODUCTS" \
  -target arm64-apple-macos14.0 \
  -swift-version 6 \
  -Onone \
  -g \
  -DDEBUG \
  -framework AppKit \
  -framework SwiftUI \
  -framework Combine \
  -Xlinker -force_load \
  -Xlinker "$SHARED_LIB" \
  -Xlinker -undefined \
  -Xlinker dynamic_lookup \
  -o "$EXECUTABLE"

codesign --force --sign - --entitlements "$ENTITLEMENTS" "$APP"

pkill -f '/PulseBarNative.app/Contents/MacOS/PulseBarNative' 2>/dev/null || true
open "$APP"
