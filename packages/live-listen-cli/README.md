# Pulse Live Listen CLI

Experimental native-side pusher for Live Listen. It is intentionally outside Pulse Native so we can test system-audio capture quality before integrating it into the app.

The CLI uses the same PartyTracks/Cloudflare Realtime SDK path as the web host, but feeds it a native WebRTC audio track:

```text
ffmpeg system audio capture
  -> signed 16-bit PCM, 48 kHz, stereo, 10 ms frames
  -> @roamhq/wrtc RTCAudioSource MediaStreamTrack
  -> PartyTracks.push()
  -> Cloudflare Realtime SFU session/track
  -> Pulse Live Listen heartbeat
  -> existing web listener UI
```

## Requirements

- Node.js with this workspace's `pnpm` install.
- `ffmpeg` on PATH.
- A macOS system-audio capture device if you want app/system audio, for example BlackHole, Loopback, or a virtual aggregate device.

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
export PULSE_AUDIO_SOURCE="device"
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

List macOS capture devices:

```bash
ffmpeg -f avfoundation -list_devices true -i ""
```

Then set `PULSE_FFMPEG_INPUT` to the audio device. For avfoundation, audio-only devices are commonly addressed as `:<index>`.

## Source modes

Device capture mode is the default and reads from a live ffmpeg input:

```bash
export PULSE_AUDIO_SOURCE="device"
export PULSE_FFMPEG_INPUT_FORMAT="avfoundation"
export PULSE_FFMPEG_INPUT=":1"
```

On macOS, the live device push path now prefers a CoreAudio-native helper for PCM capture and falls back to `ffmpeg avfoundation` only if the helper cannot start.

To isolate device/ffmpeg capture from WebRTC entirely, use capture-only mode:

```bash
export PULSE_AUDIO_SOURCE="device"
export PULSE_CAPTURE_ONLY="1"
export PULSE_AUDIO_SAMPLE_WAV_PATH="./source-capture.wav"
export PULSE_AUDIO_SAMPLE_TAP="source"
pnpm --filter @pulse/live-listen-cli push
```

In capture-only mode the CLI does not start PartyTracks or WebRTC. On macOS it prefers the CoreAudio-native helper; elsewhere it falls back to `ffmpeg`. If that WAV still stutters, the problem is definitively in the device route / capture path. If that WAV is clean, the remaining problem is the shared realtime push graph.

On macOS, capture-only now prefers a CoreAudio-native helper over `ffmpeg avfoundation` so you can isolate the device input path without the `avfoundation` demuxer in the middle. The current helper writes `WAV` output.

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

- `auto`: in `device` mode, capture the raw `ffmpeg` device PCM before the sender queue; in `file` mode, capture the paced sender feed.
- `source`: capture the raw `ffmpeg` device PCM before pacing/drop decisions.
- `sender`: capture the exact PCM frames fed into `RTCAudioSource`.

This matters for diagnosis:

- If `source` sounds bad, the problem is already in the device capture / `ffmpeg` input.
- If `source` sounds clean but `sender` or remote playback sounds bad, the remaining suspect is the Node `RTCAudioSource -> WebRTC sender -> Cloudflare Realtime` path.

For device debugging, prefer `PULSE_AUDIO_SAMPLE_WAV_PATH` with `PULSE_AUDIO_SAMPLE_TAP="source"` so you are listening to the raw avfoundation capture path without MP3 artifacts.

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

The CLI can only be independent of the user's output volume if the capture source is independent of the output device volume.

- Capturing a virtual loopback device such as BlackHole/Loopback usually captures the app/system mix before speaker output volume, but exact behavior depends on the routing graph.
- Capturing from a physical microphone or monitor path can be affected by gain/volume and can include room noise.
- For a future Pulse Native implementation, prefer a dedicated system-audio capture path or virtual device route that taps PCM before final speaker attenuation.

Practical test:

1. Start Spotify playback routed into the capture device.
2. Start the CLI.
3. Change Mac speaker/output volume.
4. Watch listener loudness and CLI/SFU stats.

If listener loudness changes with speaker volume, the chosen capture route is post-volume and is not suitable for stable native Live Listen.
