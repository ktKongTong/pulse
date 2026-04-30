import type { Subscription } from "rxjs";
import { PartyTracks } from "partytracks/client";

export type LiveListenAudioStats = {
  direction: "inbound" | "outbound";
  bitrateKbps: number | null;
  bytes: number | null;
  codec: string | null;
  connectionState: RTCPeerConnectionState | null;
  jitterMs: number | null;
  packets: number | null;
  packetsLost: number | null;
  roundTripTimeMs: number | null;
  timestamp: number;
};

type StatRecord = RTCStats & Record<string, unknown>;

type PreviousSample = {
  bytes: number;
  timestamp: number;
};

export function emptyAudioStats(direction: LiveListenAudioStats["direction"]): LiveListenAudioStats {
  return {
    direction,
    bitrateKbps: null,
    bytes: null,
    codec: null,
    connectionState: null,
    jitterMs: null,
    packets: null,
    packetsLost: null,
    roundTripTimeMs: null,
    timestamp: Date.now(),
  };
}

export function startPartyTracksAudioStats(
  partyTracks: PartyTracks,
  direction: LiveListenAudioStats["direction"],
  onStats: (stats: LiveListenAudioStats) => void,
): Subscription {
  let timer: number | null = null;
  let previous: PreviousSample | null = null;

  const stopTimer = () => {
    if (timer !== null) {
      window.clearInterval(timer);
      timer = null;
    }
    previous = null;
  };

  const subscription = partyTracks.peerConnection$.subscribe((peerConnection) => {
    stopTimer();

    const collect = async () => {
      const report = await peerConnection.getStats();
      const media = findAudioRtpStats(report, direction);
      if (!media) {
        onStats({
          ...emptyAudioStats(direction),
          connectionState: peerConnection.connectionState,
        });
        return;
      }

      const bytes = direction === "outbound"
        ? numberValue(media.bytesSent)
        : numberValue(media.bytesReceived);
      const packets = direction === "outbound"
        ? numberValue(media.packetsSent)
        : numberValue(media.packetsReceived);
      const timestamp = numberValue(media.timestamp) ?? Date.now();
      const bitrateKbps = bytes !== null && previous
        ? Math.max(0, ((bytes - previous.bytes) * 8) / Math.max(1, timestamp - previous.timestamp))
        : null;
      if (bytes !== null) previous = { bytes, timestamp };

      onStats({
        direction,
        bitrateKbps,
        bytes,
        codec: codecName(report, media),
        connectionState: peerConnection.connectionState,
        jitterMs: secondsToMs(numberValue(media.jitter)),
        packets,
        packetsLost: numberValue(media.packetsLost),
        roundTripTimeMs: secondsToMs(numberValue(media.roundTripTime)),
        timestamp,
      });
    };

    void collect();
    timer = window.setInterval(() => void collect(), 1_000);
  });

  return {
    unsubscribe() {
      stopTimer();
      subscription.unsubscribe();
    },
  };
}

function findAudioRtpStats(
  report: RTCStatsReport,
  direction: LiveListenAudioStats["direction"],
): StatRecord | null {
  const targetType = direction === "outbound" ? "outbound-rtp" : "inbound-rtp";
  for (const stat of report.values()) {
    const record = stat as StatRecord;
    if (record.type !== targetType) continue;
    if (record.isRemote === true) continue;
    if (record.kind !== "audio" && record.mediaType !== "audio") continue;
    return record;
  }
  return null;
}

function codecName(report: RTCStatsReport, media: StatRecord): string | null {
  const codecId = stringValue(media.codecId);
  if (!codecId) return null;
  const codec = report.get(codecId) as StatRecord | undefined;
  return stringValue(codec?.mimeType) ?? stringValue(codec?.payloadType);
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringValue(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number") return String(value);
  return null;
}

function secondsToMs(value: number | null) {
  return value === null ? null : value * 1000;
}
