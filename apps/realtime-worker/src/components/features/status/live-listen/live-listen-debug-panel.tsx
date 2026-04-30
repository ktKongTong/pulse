import { useLiveListen } from "./use-live-listen";
import { useAudioWaveform } from "./use-audio-waveform";
import { useSenderWaveform } from "./use-sender-waveform";
import { AudioWaveformStrip } from "./audio-waveform-strip";
import { commonWaveformWindowEnd, latestWaveformPoint, normalizeWaveformHistory, waveformScaleMax } from "./waveform-types";

const DEBUG_WINDOW_MS = 2_000;

export function LiveListenDebugPanel() {
  const liveListen = useLiveListen();
  const isConnected = liveListen.connectionState === "connected" || liveListen.connectionState === "listening";
  const receiverRawHistory = useAudioWaveform({
    audioTrack: liveListen.remoteAudioTrack,
    enabled: isConnected,
    bins: 48,
  });
  const sender = useSenderWaveform();
  const windowEnd = commonWaveformWindowEnd([sender.history, receiverRawHistory]);
  const senderPoints = normalizeWaveformHistory(sender.history, 48, DEBUG_WINDOW_MS, windowEnd);
  const receiverPoints = normalizeWaveformHistory(receiverRawHistory, 48, DEBUG_WINDOW_MS, windowEnd);
  const scaleMax = waveformScaleMax([senderPoints, receiverPoints]);
  const senderCurrent = latestWaveformPoint(sender.history);
  const receiverCurrent = latestWaveformPoint(receiverRawHistory);

  return (
    <main className="min-h-screen bg-stone-950 px-6 py-10 text-stone-100">
      <section className="mx-auto flex max-w-5xl flex-col gap-6 rounded-3xl border border-white/10 bg-white/5 p-6 shadow-2xl">
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-emerald-300">Pulse Live Listen</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">Sender vs receiver audio debug</h1>
          <p className="mt-2 text-sm text-stone-400">
            Compare the CLI sender waveform telemetry against the browser receiver output in real time over the same recent 2 second window.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs text-stone-300">
          <audio ref={liveListen.audioRef} autoPlay playsInline />
          <button
            type="button"
            disabled={!liveListen.canJoin || liveListen.connectionState === "joining"}
            onClick={liveListen.join}
            className="rounded-full bg-emerald-400 px-4 py-2 font-medium uppercase tracking-[0.16em] text-stone-950 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {liveListen.connectionState === "joining" ? "Joining" : isConnected ? "Connected" : "Join receiver"}
          </button>
          <span>receiver state: {liveListen.connectionState}</span>
          <span>snapshot: {liveListen.snapshot?.state ?? "offline"}</span>
          <span>bitrate: {formatNullable(liveListen.audioStats.bitrateKbps, "kbps")}</span>
          <span>jitter: {formatNullable(liveListen.audioStats.jitterMs, "ms")}</span>
          <span>lost: {liveListen.audioStats.packetsLost ?? "-"}</span>
          <span>sender url: {sender.url}</span>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl bg-black/20 p-4">
            <AudioWaveformStrip currentPoint={senderCurrent} points={senderPoints} scaleMax={scaleMax} label="CLI sender" tone="emerald" />
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-400">
              <span>queued: {sender.snapshot?.metrics.queued ?? "-"}</span>
              <span>clockDrops: {sender.snapshot?.metrics.clockDrops ?? "-"}</span>
              <span>lateTicks: {sender.snapshot?.metrics.lateTicks ?? "-"}</span>
              <span>maxLateMs: {formatMetric(sender.snapshot?.metrics.maxLateMs)}</span>
              <span>updated: {formatAge(sender.snapshot?.updatedAt)}</span>
            </div>
            {sender.error ? <div className="mt-2 text-xs text-red-300">{sender.error}</div> : null}
          </div>
          <div className="rounded-2xl bg-black/20 p-4">
            <AudioWaveformStrip currentPoint={receiverCurrent} points={receiverPoints} scaleMax={scaleMax} label="Browser receiver" tone="sky" />
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-400">
              <span>bitrate: {formatNullable(liveListen.audioStats.bitrateKbps, "kbps")}</span>
              <span>bytesΔ/s: {formatRate(liveListen.audioStats.bytesDeltaPerSecond, "B/s")}</span>
              <span>jitter: {formatNullable(liveListen.audioStats.jitterMs, "ms")}</span>
              <span>lostΔ/s: {formatRate(liveListen.audioStats.packetsLostDeltaPerSecond, "pkts")}</span>
              <span>concealΔ/s: {formatRate(liveListen.audioStats.concealmentEventsDeltaPerSecond, "evt")}</span>
              <span>concealedΔ/s: {formatRate(liveListen.audioStats.concealedSamplesDeltaPerSecond, "samples")}</span>
              <span>jbDelay: {formatNullable(liveListen.audioStats.jitterBufferDelayMs, "ms")}</span>
              <span>rtt: {formatNullable(liveListen.audioStats.roundTripTimeMs, "ms")}</span>
            </div>
            {liveListen.error ? <div className="mt-2 text-xs text-red-300">{liveListen.error}</div> : null}
          </div>
        </div>
      </section>
    </main>
  );
}

function formatAge(updatedAt: number | undefined) {
  if (!updatedAt) return "-";
  const ageMs = Math.max(0, Date.now() - updatedAt);
  return `${ageMs}ms`;
}

function formatMetric(value: number | undefined) {
  return typeof value === "number" ? value.toFixed(1) : "-";
}

function formatNullable(value: number | null, suffix: string) {
  return value === null ? "-" : `${value.toFixed(1)}${suffix}`;
}

function formatRate(value: number | null, suffix: string) {
  return value === null ? "-" : `${value.toFixed(1)} ${suffix}`;
}
