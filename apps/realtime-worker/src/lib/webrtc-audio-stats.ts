import type { Subscription } from "rxjs";
import { PartyTracks } from "partytracks/client";

export type LiveListenAudioStats = {
  direction: "inbound" | "outbound";
  bitrateKbps: number | null;
  bytes: number | null;
  bytesDeltaPerSecond: number | null;
  codec: string | null;
  concealedSamples: number | null;
  concealedSamplesDeltaPerSecond: number | null;
  concealmentEvents: number | null;
  concealmentEventsDeltaPerSecond: number | null;
  connectionState: RTCPeerConnectionState | null;
  jitterBufferDelayMs: number | null;
  jitterBufferEmittedCount: number | null;
  jitterBufferTargetDelayMs: number | null;
  jitterMs: number | null;
  packets: number | null;
  packetsDeltaPerSecond: number | null;
  packetsLost: number | null;
  packetsLostDeltaPerSecond: number | null;
  roundTripTimeMs: number | null;
  timestamp: number;
};

type StatRecord = RTCStats & Record<string, unknown>;

type PreviousSample = {
  bytes: number;
  concealedSamples: number | null;
  concealmentEvents: number | null;
  jitterBufferDelay: number | null;
  jitterBufferEmittedCount: number | null;
  packets: number | null;
  packetsLost: number | null;
  timestamp: number;
};

export function emptyAudioStats(direction: LiveListenAudioStats["direction"]): LiveListenAudioStats {
  return {
    direction,
    bitrateKbps: null,
    bytes: null,
    bytesDeltaPerSecond: null,
    codec: null,
    concealedSamples: null,
    concealedSamplesDeltaPerSecond: null,
    concealmentEvents: null,
    concealmentEventsDeltaPerSecond: null,
    connectionState: null,
    jitterBufferDelayMs: null,
    jitterBufferEmittedCount: null,
    jitterBufferTargetDelayMs: null,
    jitterMs: null,
    packets: null,
    packetsDeltaPerSecond: null,
    packetsLost: null,
    packetsLostDeltaPerSecond: null,
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
      const packetsLost = numberValue(media.packetsLost);
      const concealmentEvents = numberValue(media.concealmentEvents);
      const concealedSamples = numberValue(media.concealedSamples);
      const jitterBufferDelay = numberValue(media.jitterBufferDelay);
      const jitterBufferEmittedCount = numberValue(media.jitterBufferEmittedCount);
      const timestamp = numberValue(media.timestamp) ?? Date.now();
      const bitrateKbps = bytes !== null && previous
        ? Math.max(0, ((bytes - previous.bytes) * 8) / Math.max(1, timestamp - previous.timestamp))
        : null;
      const elapsedSeconds = previous ? Math.max(0.001, (timestamp - previous.timestamp) / 1000) : null;
      const bytesDeltaPerSecond = bytes !== null && previous && elapsedSeconds !== null
        ? Math.max(0, (bytes - previous.bytes) / elapsedSeconds)
        : null;
      const packetsDeltaPerSecond = packets !== null && previous?.packets !== null && elapsedSeconds !== null
        ? Math.max(0, (packets - previous.packets) / elapsedSeconds)
        : null;
      const packetsLostDeltaPerSecond = packetsLost !== null && previous?.packetsLost !== null && elapsedSeconds !== null
        ? Math.max(0, (packetsLost - previous.packetsLost) / elapsedSeconds)
        : null;
      const concealmentEventsDeltaPerSecond = concealmentEvents !== null && previous?.concealmentEvents !== null && elapsedSeconds !== null
        ? Math.max(0, (concealmentEvents - previous.concealmentEvents) / elapsedSeconds)
        : null;
      const concealedSamplesDeltaPerSecond = concealedSamples !== null && previous?.concealedSamples !== null && elapsedSeconds !== null
        ? Math.max(0, (concealedSamples - previous.concealedSamples) / elapsedSeconds)
        : null;
      const jitterBufferDelayMs = jitterBufferDelay !== null && previous?.jitterBufferDelay !== null && previous?.jitterBufferEmittedCount !== null && jitterBufferEmittedCount !== null
        ? secondsToMs((jitterBufferDelay - previous.jitterBufferDelay) / Math.max(1, jitterBufferEmittedCount - previous.jitterBufferEmittedCount))
        : secondsToMs(jitterBufferDelay);
      if (bytes !== null) {
        previous = {
          bytes,
          concealedSamples,
          concealmentEvents,
          jitterBufferDelay,
          jitterBufferEmittedCount,
          packets,
          packetsLost,
          timestamp,
        };
      }

      onStats({
        direction,
        bitrateKbps,
        bytes,
        bytesDeltaPerSecond,
        codec: codecName(report, media),
        concealedSamples,
        concealedSamplesDeltaPerSecond,
        concealmentEvents,
        concealmentEventsDeltaPerSecond,
        connectionState: peerConnection.connectionState,
        jitterBufferDelayMs,
        jitterBufferEmittedCount,
        jitterBufferTargetDelayMs: secondsToMs(numberValue(media.jitterBufferTargetDelay)),
        jitterMs: secondsToMs(numberValue(media.jitter)),
        packets,
        packetsDeltaPerSecond,
        packetsLost,
        packetsLostDeltaPerSecond,
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
