import { Subscription } from "rxjs";
import { PartyTracks } from "partytracks/client";

export type LiveListenAudioStats = {
  direction: "inbound" | "outbound";
  bitrateKbps: number | null;
  bytes: number | null;
  bytesDeltaPerSecond: number | null;
  codec: string | null;
  audioLevel: number | null;
  concealedSamples: number | null;
  concealedSamplesDeltaPerSecond: number | null;
  concealmentEvents: number | null;
  concealmentEventsDeltaPerSecond: number | null;
  connectionState: RTCPeerConnectionState | null;
  jitterBufferDelayMs: number | null;
  jitterBufferEmittedCount: number | null;
  jitterBufferTargetDelayMs: number | null;
  jitterBufferMinimumDelayMs: number | null;
  jitterMs: number | null;
  packets: number | null;
  packetsDiscarded: number | null;
  packetsReceived: number | null;
  totalAudioEnergy: number | null;
  totalSamplesDuration: number | null;
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
  jitterBufferTargetDelay: number | null;
  jitterBufferMinimumDelay: number | null;
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
    audioLevel: null,
    concealedSamples: null,
    concealedSamplesDeltaPerSecond: null,
    concealmentEvents: null,
    concealmentEventsDeltaPerSecond: null,
    connectionState: null,
    jitterBufferDelayMs: null,
    jitterBufferEmittedCount: null,
    jitterBufferTargetDelayMs: null,
    jitterBufferMinimumDelayMs: null,
    jitterMs: null,
    packets: null,
    packetsDeltaPerSecond: null,
    packetsDiscarded: null,
    packetsReceived: null,
    totalAudioEnergy: null,
    totalSamplesDuration: null,
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
      const packetsDiscarded = numberValue(media.packetsDiscarded);
      const packetsReceived = numberValue(media.packetsReceived);
      const audioLevel = numberValue(media.audioLevel);
      const totalAudioEnergy = numberValue(media.totalAudioEnergy);
      const totalSamplesDuration = numberValue(media.totalSamplesDuration);
      const concealmentEvents = numberValue(media.concealmentEvents);
      const concealedSamples = numberValue(media.concealedSamples);
      const jitterBufferDelay = numberValue(media.jitterBufferDelay);
      const jitterBufferTargetDelay = numberValue(media.jitterBufferTargetDelay);
      const jitterBufferMinimumDelay = numberValue(media.jitterBufferMinimumDelay);
      const jitterBufferEmittedCount = numberValue(media.jitterBufferEmittedCount);
      const timestamp = numberValue(media.timestamp) ?? Date.now();
      const previousSample = previous;
      let bitrateKbps: number | null = null;
      let bytesDeltaPerSecond: number | null = null;
      let packetsDeltaPerSecond: number | null = null;
      let packetsLostDeltaPerSecond: number | null = null;
      let concealmentEventsDeltaPerSecond: number | null = null;
      let concealedSamplesDeltaPerSecond: number | null = null;
      let jitterBufferDelayMs = secondsToMs(jitterBufferDelay);
      let jitterBufferTargetDelayMs = secondsToMs(jitterBufferTargetDelay);
      let jitterBufferMinimumDelayMs = secondsToMs(jitterBufferMinimumDelay);

      if (previousSample) {
        const elapsedSeconds = Math.max(0.001, (timestamp - previousSample.timestamp) / 1000);
        const elapsedMs = Math.max(1, timestamp - previousSample.timestamp);

        if (bytes !== null) {
          bitrateKbps = Math.max(0, ((bytes - previousSample.bytes) * 8) / elapsedMs);
          bytesDeltaPerSecond = Math.max(0, (bytes - previousSample.bytes) / elapsedSeconds);
        }
        if (packets !== null && previousSample.packets !== null) {
          packetsDeltaPerSecond = Math.max(0, (packets - previousSample.packets) / elapsedSeconds);
        }
        if (packetsLost !== null && previousSample.packetsLost !== null) {
          packetsLostDeltaPerSecond = Math.max(0, (packetsLost - previousSample.packetsLost) / elapsedSeconds);
        }
        if (concealmentEvents !== null && previousSample.concealmentEvents !== null) {
          concealmentEventsDeltaPerSecond = Math.max(0, (concealmentEvents - previousSample.concealmentEvents) / elapsedSeconds);
        }
        if (concealedSamples !== null && previousSample.concealedSamples !== null) {
          concealedSamplesDeltaPerSecond = Math.max(0, (concealedSamples - previousSample.concealedSamples) / elapsedSeconds);
        }
        if (
          jitterBufferDelay !== null
          && previousSample.jitterBufferDelay !== null
          && jitterBufferEmittedCount !== null
          && previousSample.jitterBufferEmittedCount !== null
        ) {
          const emittedDelta = Math.max(1, jitterBufferEmittedCount - previousSample.jitterBufferEmittedCount);
          jitterBufferDelayMs = secondsToMs(
            (jitterBufferDelay - previousSample.jitterBufferDelay) / emittedDelta,
          );
          if (jitterBufferTargetDelay !== null && previousSample.jitterBufferTargetDelay !== null) {
            jitterBufferTargetDelayMs = secondsToMs(
              (jitterBufferTargetDelay - previousSample.jitterBufferTargetDelay) / emittedDelta,
            );
          }
          if (jitterBufferMinimumDelay !== null && previousSample.jitterBufferMinimumDelay !== null) {
            jitterBufferMinimumDelayMs = secondsToMs(
              (jitterBufferMinimumDelay - previousSample.jitterBufferMinimumDelay) / emittedDelta,
            );
          }
        }
      }
      if (bytes !== null) {
        previous = {
          bytes,
          concealedSamples,
          concealmentEvents,
          jitterBufferDelay,
          jitterBufferEmittedCount,
          jitterBufferTargetDelay,
          jitterBufferMinimumDelay,
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
        audioLevel,
        concealedSamples,
        concealedSamplesDeltaPerSecond,
        concealmentEvents,
        concealmentEventsDeltaPerSecond,
        connectionState: peerConnection.connectionState,
        jitterBufferDelayMs,
        jitterBufferEmittedCount,
        jitterBufferTargetDelayMs,
        jitterBufferMinimumDelayMs,
        jitterMs: secondsToMs(numberValue(media.jitter)),
        packets,
        packetsDeltaPerSecond,
        packetsDiscarded,
        packetsReceived,
        packetsLost,
        packetsLostDeltaPerSecond,
        roundTripTimeMs: secondsToMs(numberValue(media.roundTripTime)),
        totalAudioEnergy,
        totalSamplesDuration,
        timestamp,
      });
    };

    void collect();
    timer = window.setInterval(() => void collect(), 1_000);
  });

  return new Subscription(() => {
    stopTimer();
    subscription.unsubscribe();
  });
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
