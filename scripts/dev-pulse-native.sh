#!/bin/zsh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DERIVED="$ROOT/macosApp/.xcode-derived"
PRODUCTS="$DERIVED/Build/Products/Debug"
APP="$PRODUCTS/PulseBarNative.app"
EXECUTABLE="$APP/Contents/MacOS/PulseBarNative"
ENTITLEMENTS="$ROOT/macosApp/PulseBarNative/PulseBarNative.entitlements"
SHARED_LIB="$PRODUCTS/libPulseBarShared.a"
OPEN_APP=1
VERIFY_LAUNCH=0
REBUILD_KOTLIN=1

for arg in "$@"; do
  case "$arg" in
    --no-open)
      OPEN_APP=0
      ;;
    --verify)
      VERIFY_LAUNCH=1
      ;;
    --skip-kotlin)
      REBUILD_KOTLIN=0
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      exit 2
      ;;
  esac
done

if [[ "$REBUILD_KOTLIN" -eq 1 ]]; then
  SDK_VERSION="$(xcrun --sdk macosx --show-sdk-version)"
  export SDK_NAME="macosx${SDK_VERSION}"
  export CONFIGURATION="Debug"
  export TARGET_BUILD_DIR="$PRODUCTS"
  export BUILT_PRODUCTS_DIR="$PRODUCTS"
  export ARCHS="arm64"
  export DEPLOYMENT_TARGET_SETTING_NAME="MACOSX_DEPLOYMENT_TARGET"
  export MACOSX_DEPLOYMENT_TARGET="14.0"
  export FRAMEWORKS_FOLDER_PATH="PulseBarNative.app/Contents/Frameworks"
  export DERIVED_FILE_DIR="$DERIVED/Build/Intermediates.noindex/PulseBarNative.build/Debug/PulseBarNative.build/DerivedSources"
  export JAVA_HOME="${JAVA_HOME:-$HOME/Library/Java/JavaVirtualMachines/jbr-21.0.9/Contents/Home}"
  export PATH="$JAVA_HOME/bin:$PATH"
  export GRADLE_USER_HOME="$ROOT/.gradle-xcode"
  export KONAN_DATA_DIR="${KONAN_DATA_DIR:-$HOME/.konan}"
  mkdir -p "$TARGET_BUILD_DIR" "$DERIVED_FILE_DIR"
  (cd "$ROOT" && ./gradlew --no-daemon -Dorg.gradle.vfs.watch=false :common:embedSwiftExportForXcode)
fi

if [[ ! -f "$SHARED_LIB" ]]; then
  echo "Missing shared export library: $SHARED_LIB" >&2
  exit 1
fi

mkdir -p "$APP/Contents/MacOS"
rm -rf "$APP/Contents/Frameworks/WebRTC.framework"
rm -f "$PRODUCTS/LiveListenObjCAudioDevice.o"

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
	<key>NSAudioCaptureUsageDescription</key>
	<string>PulseBar captures system audio for Live Listen streams after you start capture.</string>
	<key>NSScreenCaptureUsageDescription</key>
	<string>PulseBar may need screen and system audio recording permission to capture Live Listen audio.</string>
</dict>
</plist>
EOF

printf 'APPL????' > "$APP/Contents/PkgInfo"

swiftc \
  $(find "$ROOT"/macosApp/PulseBarNative -name '*.swift' -type f) \
  -I "$PRODUCTS" \
  -F "$PRODUCTS" \
  -L "$PRODUCTS" \
  -target arm64-apple-macos14.0 \
  -swift-version 6 \
  -Onone \
  -g \
  -DDEBUG \
  -framework AppKit \
  -framework AudioToolbox \
  -framework CoreAudio \
  -framework SwiftUI \
  -framework Combine \
  -Xlinker -rpath \
  -Xlinker @executable_path/../Frameworks \
  -Xlinker -force_load \
  -Xlinker "$SHARED_LIB" \
  -Xlinker -undefined \
  -Xlinker dynamic_lookup \
  -o "$EXECUTABLE"

if [[ -d "$APP/Contents/Frameworks" ]]; then
  find "$APP/Contents/Frameworks" -type d -name '*.framework' -maxdepth 2 -print0 | while IFS= read -r -d '' framework; do
    codesign --force --sign - "$framework"
  done
fi
codesign --force --sign - --entitlements "$ENTITLEMENTS" --deep "$APP"

pkill -f '/PulseBarNative.app/Contents/MacOS/PulseBarNative' 2>/dev/null || true
for _ in {1..40}; do
  if ! pgrep -f '/PulseBarNative.app/Contents/MacOS/PulseBarNative' >/dev/null 2>&1; then
    break
  fi
  sleep 0.05
done

if [[ "$OPEN_APP" -eq 0 ]]; then
  echo "Built PulseBarNative.app at $APP"
  exit 0
fi

if ! /usr/bin/open -n "$APP"; then
  echo "Failed to open PulseBarNative.app via LaunchServices" >&2
  exit 1
fi

if [[ "$VERIFY_LAUNCH" -eq 1 ]]; then
  for _ in {1..40}; do
    if pgrep -f '/PulseBarNative.app/Contents/MacOS/PulseBarNative' >/dev/null 2>&1; then
      echo "PulseBarNative launched"
      exit 0
    fi
    sleep 0.1
  done
  echo "PulseBarNative did not appear after launch" >&2
  exit 1
fi
