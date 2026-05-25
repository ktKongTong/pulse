import { DEVICE_MEDIA_PROTOCOL, PRESENCE_PROTOCOL } from "@ktfun/pulse-protocol";

export const tracks = [
  {
    provider: "spotify",
    title: "視界の隅 朽ちる音 - 新川崎（仮）",
    artist: "棘ナシ",
    album: "TOGENASHI TOGEARI",
    artworkUrl: "https://picsum.photos/seed/pulse-v2-b/320/320",
  },
  {
    provider: "spotify",
    title: "Durable Object Heartbeat",
    artist: "KT Lab",
    album: "Realtime Mock",
    artworkUrl: "https://picsum.photos/seed/pulse-v2-c/320/320",
  },
];

export const focusApps = [
  { id: "com.microsoft.edgemac", name: "Microsoft Edge", category: "browser" },
  { id: "com.openai.codex", name: "Codex", category: "developer" },
  { id: "com.apple.Music", name: "Music", category: "media" },
];

export function buildPresenceSnapshot(input: {
  seq: number;
  sentAt: string;
  focus: (typeof focusApps)[number];
}) {
  return {
    protocol: PRESENCE_PROTOCOL,
    type: "snapshot",
    payload: {
      eventId: crypto.randomUUID(),
      seq: input.seq,
      observedAt: input.sentAt,
      sentAt: input.sentAt,
      state: {
        availability: { state: "active", idleSeconds: 0 },
        focus: {
          app: {
            ...input.focus,
            window: { title: `${input.focus.name} - Pulse Mock` },
            page: { title: "Pulse Status", url: "http://localhost:8910/" },
          },
        },
      },
    },
  };
}

export function buildMediaUpdate(input: {
  seq: number;
  sentAt: string;
  track: (typeof tracks)[number];
}) {
  const progressSeconds = (input.seq * 2) % 180;
  return {
    protocol: DEVICE_MEDIA_PROTOCOL,
    type: "media.updated",
    payload: {
      sentAt: input.sentAt,
      media: {
        ...input.track,
        id: `mock-${input.seq}`,
        playbackState: "playing",
        progressSeconds,
        durationSeconds: 180,
      },
      clock: {
        mediaProgressSeconds: progressSeconds,
        durationSeconds: 180,
        updatedAt: input.sentAt,
      },
    },
  };
}

export function buildStreamReady() {
  return {
    protocol: DEVICE_MEDIA_PROTOCOL,
    type: "stream.state.updated",
    payload: {
      sentAt: new Date().toISOString(),
      state: {
        permission: "allow",
        playback: "playing",
        capture: "no-capture",
        streamFormat: {
          codec: "mp3",
          sampleRate: 44_100,
          channels: 2,
        },
      },
    },
  };
}
