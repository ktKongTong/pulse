# Pulse Live Listen CLI

Experimental native-side pusher for Live Listen. It is intentionally outside Pulse Native so we can test system-audio capture quality before integrating it into the app.

The CLI uses the same PartyTracks/Cloudflare Realtime SDK path as the web host, but feeds it a native WebRTC audio track:

```text
Core Audio system tap or device capture
  -> signed 16-bit PCM, 48 kHz, stereo, 10 ms frames
  -> @roamhq/wrtc RTCAudioSource MediaStreamTrack
  -> PartyTracks.push()
  -> Cloudflare Realtime SFU session/track
  -> Pulse Live Listen heartbeat
  -> existing web listener UI
```

## Requirements

- Node.js with this workspace's `pnpm` install.
- macOS 14.2+ for `system-tap` mode.
- `ffmpeg` on PATH for `device` fallback, file mode, and MP3 sample output.
- A macOS system-audio capture device such as BlackHole/Loopback only if you use legacy `device` mode for app/system audio.

## Environment

Required:

```bash
export PULSE_DEVICE_API_KEY="..."
```

Useful defaults:

```bash
export PULSE_BASE_URL="https://pulse.koft.space"
export PULSE_WORKSPACE_ID="koft"
export PULSE_LIVE_LISTEN_ROOM_ID="live-listen:owner"
export PULSE_FORCE_TURN_RELAY="1"
export PULSE_AUDIO_SOURCE="system-tap"
export PULSE_AUDIO_MAX_BITRATE_BPS="320000"
export PULSE_AUDIO_FRAME_MS="10"
export PULSE_AUDIO_STARTUP_BUFFER_MS="200"
export PULSE_AUDIO_MAX_QUEUE_MS="2000"
export PULSE_AUDIO_MAX_BURST_FRAMES="8"
export PULSE_AUDIO_SAMPLE_MP3_PATH="./sample-capture.mp3"
export PULSE_AUDIO_SAMPLE_WAV_PATH="./source-capture.wav"
export PULSE_AUDIO_SAMPLE_SECONDS="30"
export PULSE_AUDIO_SAMPLE_TAP="auto"
export PULSE_CAPTURE_ONLY="0"
export PULSE_DEBUG_WAVEFORM_PORT="9323"
export PULSE_FFMPEG_INPUT_FORMAT="avfoundation"
export PULSE_FFMPEG_INPUT=":0"
```

Run:

```bash
pnpm --filter @pulse/live-listen-cli push
```

If `PULSE_DEBUG_WAVEFORM_PORT` is set to a positive port, the CLI exposes sender waveform telemetry at `http://127.0.0.1:<port>/waveform` for the browser debug page.

`system-tap` mode does not require selecting a BlackHole input device. List macOS capture devices only when using legacy `device` mode:

```bash
ffmpeg -f avfoundation -list_devices true -i ""
```

Then set `PULSE_FFMPEG_INPUT` to the audio device. For avfoundation, audio-only devices are commonly addressed as `:<index>`.

## Source modes

System tap mode is the preferred macOS path. It uses a private Core Audio process tap and does not change the default output device, so AirPods/speaker volume keys keep controlling the real output device:

```bash
export PULSE_AUDIO_SOURCE="system-tap"
pnpm --filter @pulse/live-listen-cli push
```

To verify capture quality without WebRTC:

```bash
export PULSE_AUDIO_SOURCE="system-tap"
export PULSE_CAPTURE_ONLY="1"
export PULSE_AUDIO_SAMPLE_WAV_PATH="./system-tap.wav"
export PULSE_AUDIO_SAMPLE_SECONDS="30"
pnpm --filter @pulse/live-listen-cli push
```

If this prints `System audio capture permission was not granted`, open `System Settings > Privacy & Security > Screen & System Audio Recording` and enable `Pulse Live Listen Capture` if it appears. If it does not appear, run the capture command once from Terminal, then reopen that settings pane. The previous all-zero WAV symptom means the Core Audio tap was created but macOS had not granted `kTCCServiceAudioCapture`.

You can also trigger only the permission request through LaunchServices:

```bash
export PULSE_REQUEST_AUDIO_CAPTURE_PERMISSION="1"
pnpm --filter @pulse/live-listen-cli push
```

This builds `/tmp/pulse-coreaudio-capture.app` and opens it as `Pulse Live Listen Capture`, which gives macOS a stable app identity for the system audio recording prompt.

Capture-only `system-tap` also runs through that `.app` identity. A valid capture prints no permission error and the WAV should contain non-zero PCM data. Live streaming still needs the same app identity plus a pipe back to Node, so validate capture-only first before testing PartyTracks push.

Device capture mode reads from a live input device. On macOS it uses the same CoreAudio-native helper for PCM capture and falls back to `ffmpeg avfoundation` only if the helper cannot start:

```bash
export PULSE_AUDIO_SOURCE="device"
export PULSE_FFMPEG_INPUT_FORMAT="avfoundation"
export PULSE_FFMPEG_INPUT=":1"
```

To isolate device/ffmpeg capture from WebRTC entirely, use capture-only mode:

```bash
export PULSE_AUDIO_SOURCE="device"
export PULSE_CAPTURE_ONLY="1"
export PULSE_AUDIO_SAMPLE_WAV_PATH="./source-capture.wav"
export PULSE_AUDIO_SAMPLE_TAP="source"
pnpm --filter @pulse/live-listen-cli push
```

In capture-only mode the CLI does not start PartyTracks or WebRTC. On macOS, `system-tap` and `device` both prefer the CoreAudio-native helper. If that WAV still stutters, the problem is definitively in the native capture path. If that WAV is clean, the remaining problem is the shared realtime push graph.

On macOS, capture-only prefers the CoreAudio-native helper over `ffmpeg avfoundation` so you can isolate capture without the `avfoundation` demuxer in the middle. The helper writes `WAV` output.

File mode reads an audio file through ffmpeg, decodes it to the same PCM path, and loops it forever for repeatable quality tests:

```bash
export PULSE_AUDIO_SOURCE="file"
export PULSE_AUDIO_FILE="/absolute/path/to/test.mp3"
```

File mode pre-decodes the whole file to 48 kHz stereo PCM once, then loops that in memory with the CLI pacer as the only realtime clock. This avoids ffmpeg realtime pacing, stdout backpressure, and queue drops during repeatable quality tests.

For larger test files, raise the decode buffer if needed:

```bash
export PULSE_AUDIO_FILE_MAX_BUFFER_BYTES="1073741824"
```

## Sample Capture

Set `PULSE_AUDIO_SAMPLE_WAV_PATH` to ask the CLI to write an uncompressed WAV debug sample. `PULSE_AUDIO_SAMPLE_MP3_PATH` is still available if you also want a compressed quick-listen copy.

```bash
export PULSE_AUDIO_SAMPLE_WAV_PATH="./source-capture.wav"
export PULSE_AUDIO_SAMPLE_MP3_PATH="./sample-capture.mp3"
export PULSE_AUDIO_SAMPLE_SECONDS="30"
export PULSE_AUDIO_SAMPLE_TAP="auto"
```

`PULSE_AUDIO_SAMPLE_TAP` controls where the sample is taken from:

- `auto`: in `system-tap`/`device` mode, capture the raw native/ffmpeg source PCM before the sender queue; in `file` mode, capture the paced sender feed.
- `source`: capture the raw native/ffmpeg source PCM before pacing/drop decisions.
- `sender`: capture the exact PCM frames fed into `RTCAudioSource`.

This matters for diagnosis:

- If `source` sounds bad, the problem is already in the system tap, device capture, or `ffmpeg` fallback input.
- If `source` sounds clean but `sender` or remote playback sounds bad, the remaining suspect is the Node `RTCAudioSource -> WebRTC sender -> Cloudflare Realtime` path.

For capture debugging, prefer `PULSE_AUDIO_SAMPLE_WAV_PATH` with `PULSE_AUDIO_SAMPLE_TAP="source"` so you are listening to the raw capture path without MP3 artifacts.

## Buffer tuning

The CLI paces audio into WebRTC with a monotonic clock pacer instead of pushing ffmpeg stdout chunks directly. This is important because stdout chunks can arrive in bursts, while WebRTC audio expects a steady clock.

- `PULSE_AUDIO_FRAME_MS`: PCM frame duration sent to WebRTC. Default: `10`.
- `PULSE_AUDIO_STARTUP_BUFFER_MS`: audio buffered before the pacer starts. Default: `200`.
- `PULSE_AUDIO_MAX_QUEUE_MS`: maximum queue before dropping oldest frames. Default: `2000`.
- `PULSE_AUDIO_MAX_BURST_FRAMES`: when the Node timer wakes up late, how many 10 ms frames may be sent in one catch-up burst before older frames are dropped to stay realtime. Default: `8`.
- `PULSE_FFMPEG_AUDIO_DEPTH`: optional avfoundation input sample depth override. Accepted: `16`, `32`.
- `PULSE_FFMPEG_QUEUE_SIZE_BYTES`: optional avfoundation input queue size override in bytes.

If you hear short clicks or dropouts, try `PULSE_AUDIO_STARTUP_BUFFER_MS=500`. If the stream slowly drifts behind live playback, lower `PULSE_AUDIO_MAX_QUEUE_MS`.

The runtime log prints `queued`, `underruns`, queue `droppedFrames`, pacer `clockDrops`, `lateTicks`, and `maxLateMs` every few seconds for device mode. File mode prints the same pacer timing signals without the live ffmpeg queue counters.

The current pacer uses a monotonic clock instead of a plain fixed `setInterval` loop. When Node wakes up a little late it can send a small catch-up burst; when it wakes up too late it drops stale frames rather than letting the realtime clock drift several seconds behind.

## TURN relay

`PULSE_FORCE_TURN_RELAY=1` does two things:

1. Requests Cloudflare TURN ICE servers through the PartyTracks proxy.
2. Forces Node WebRTC to use `iceTransportPolicy: "relay"`.

The CLI prints `live-listen cli config` at startup so you can confirm `forceTurnRelay: true`.

For diagnosis, treat this as an experiment switch:

- `PULSE_FORCE_TURN_RELAY=1`: force TURN relay and reproduce the current Cloudflare relay path.
- `PULSE_FORCE_TURN_RELAY=0`: allow direct ICE candidates and compare bitrate / artifact behavior against relay mode.

## Sender Config

The CLI now matches the web host more closely on Opus sender tuning:

1. `maxBitrate` is set to `320 kbps` through `RTCRtpEncodingParameters`.
2. The local offer SDP is patched to include `stereo=1`, `sprop-stereo=1`, `maxaveragebitrate=320000`, and `useinbandfec=1`.

If the web host still sounds better after this alignment and a clean `sample-capture.mp3`, the remaining delta is the sender implementation itself: browser `AudioContext -> MediaStreamTrack` versus Node `@roamhq/wrtc RTCAudioSource`.

## Volume behavior

`system-tap` keeps the user's real output device selected. This avoids the BlackHole aggregate-device problem where macOS volume keys stop controlling AirPods because the default output is no longer AirPods.

The CLI can only be independent of the user's output volume if the capture source is independent of the output device volume.

- Capturing a virtual loopback device such as BlackHole/Loopback usually captures the app/system mix before speaker output volume, but exact behavior depends on the routing graph.
- Capturing from a physical microphone or monitor path can be affected by gain/volume and can include room noise.
- Prefer `PULSE_AUDIO_SOURCE="system-tap"` before BlackHole/aggregate-device routing. Use BlackHole only as a fallback/debug mode.
- For a future Pulse Native implementation, prefer a dedicated system-audio capture path or virtual device route that taps PCM before final speaker attenuation.

Practical test:

1. Start Spotify playback routed into the capture device.
2. Start the CLI.
3. Change Mac speaker/output volume.
4. Watch listener loudness and CLI/SFU stats.

If listener loudness changes with speaker volume, the chosen capture route is post-volume and is not suitable for stable native Live Listen.
