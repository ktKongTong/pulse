import { useMemo } from "react";

import { useLiveListen } from "@/components/features/status/live-listen/use-live-listen";

export function meta() {
  return [
    { title: "Live Listen Benchmark" },
    { name: "description", content: "Measure Live Listen WebSocket latency and playback interruptions" },
  ];
}

export default function LiveListenBenchmarkRoute() {
  const liveListen = useLiveListen();
  const stats = liveListen.stats;
  const snapshot = liveListen.snapshot;
  const report = useMemo(() => ({
    generatedAt: new Date().toISOString(),
    ws: liveListen.ws,
    streaming: liveListen.streaming,
    command: liveListen.command,
    streamable: liveListen.streamable,
    audioFlow: snapshot?.audioFlow,
    stats,
  }), [liveListen.command, liveListen.streamable, liveListen.streaming, liveListen.ws, snapshot?.audioFlow, stats]);

  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-8 text-neutral-100">
      <section className="mx-auto flex max-w-6xl flex-col gap-6">
        <header className="flex flex-col gap-4 border-b border-white/10 pb-6 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-300">Pulse Live Listen</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">WebSocket Stream Benchmark</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-400">
              Measures chunk receive latency, scheduled playback latency, decode cost, queue depth, and cumulative playback underrun time for the current browser receiver.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={liveListen.join}
              disabled={!liveListen.canJoin || liveListen.streaming || liveListen.command !== "idle"}
              className="rounded-md bg-cyan-300 px-4 py-2 text-sm font-semibold text-neutral-950 disabled:cursor-not-allowed disabled:opacity-45"
            >
              {liveListen.command === "joining" ? "Joining" : liveListen.streaming ? "Streaming" : "Start"}
            </button>
            <button
              type="button"
              onClick={liveListen.leave}
              disabled={!liveListen.streaming && liveListen.command === "idle"}
              className="rounded-md border border-white/15 px-4 py-2 text-sm font-semibold text-neutral-200 disabled:cursor-not-allowed disabled:opacity-45"
            >
              Stop
            </button>
          </div>
        </header>

        <section className="grid gap-3 md:grid-cols-4">
          <Metric label="WS" value={liveListen.ws} />
          <Metric label="Stream" value={liveListen.streaming ? "streaming" : liveListen.streamable.value ? "ready" : liveListen.streamable.reason} />
          <Metric label="Audio Flow" value={snapshot?.audioFlow.state ?? "-"} />
          <Metric label="Seq" value={`${stats.lastSeq ?? "-"} / ${stats.latestSeq ?? "-"}`} />
        </section>

        <section className="grid gap-3 md:grid-cols-3">
          <Metric label="Server to Receive" value={formatMs(stats.serverToReceiveLatencyMs)} detail="DO ingress timestamp to browser receive" tone={latencyTone(stats.serverToReceiveLatencyMs, 400, 900)} />
          <Metric label="Receive to Play" value={formatMs(stats.receiveToPlayLatencyMs)} detail="Browser receive to scheduled audio start" tone={latencyTone(stats.receiveToPlayLatencyMs, 900, 1600)} />
          <Metric label="Server to Play" value={formatMs(stats.serverToPlayLatencyMs)} detail={`max ${formatMs(stats.maxServerToPlayLatencyMs)}`} tone={latencyTone(stats.serverToPlayLatencyMs, 1200, 2200)} />
        </section>

        <section className="grid gap-3 md:grid-cols-4">
          <Metric label="Queue" value={`${stats.queuedSeconds.toFixed(2)}s`} detail="Current scheduled audio buffer" tone={stats.queuedSeconds < 0.2 && liveListen.streaming ? "bad" : "normal"} />
          <Metric label="Decode" value={formatMs(stats.decodeMs)} detail="Last chunk decodeAudioData cost" />
          <Metric label="Bitrate" value={stats.receiveBitrateKbps == null ? "-" : `${stats.receiveBitrateKbps.toFixed(1)}kbps`} detail={formatBytes(stats.receivedBytes)} />
          <Metric label="Chunk" value={`${stats.chunkCount}`} detail={`last ${formatBytes(stats.lastChunkBytes)}`} />
        </section>

        <section className="grid gap-3 md:grid-cols-4">
          <Metric label="Cumulative Interruption" value={formatMs(stats.cumulativeUnderrunMs)} detail={`${stats.underrunCount} underruns`} tone={stats.cumulativeUnderrunMs > 0 ? "bad" : "good"} />
          <Metric label="Last Interruption" value={formatMs(stats.lastUnderrunMs)} detail={`max ${formatMs(stats.maxUnderrunMs)}`} tone={stats.lastUnderrunMs > 1 ? "bad" : "normal"} />
          <Metric label="Measured Audio" value={`${stats.measuredSeconds.toFixed(1)}s`} detail="Decoded playback duration" />
          <Metric label="Interruption Ratio" value={formatPercent(stats.interruptionRatio)} detail="cumulative interruption / measured audio" tone={stats.interruptionRatio > 0.01 ? "bad" : "good"} />
        </section>

        {liveListen.error ? <p className="rounded-md border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-200">{liveListen.error}</p> : null}

        <section className="grid gap-3 lg:grid-cols-[1fr_1fr]">
          <div className="rounded-md border border-white/10 bg-white/[0.03] p-4">
            <h2 className="text-sm font-semibold text-neutral-200">Benchmark Report</h2>
            <pre className="mt-3 max-h-[420px] overflow-auto rounded bg-black/35 p-3 text-xs leading-5 text-neutral-300">{JSON.stringify(report, null, 2)}</pre>
          </div>
          <div className="rounded-md border border-white/10 bg-white/[0.03] p-4">
            <h2 className="text-sm font-semibold text-neutral-200">Interpretation</h2>
            <dl className="mt-3 grid gap-3 text-sm text-neutral-300">
              <Row label="Server to Receive" value="WebSocket transit plus browser dispatch time. This is approximate because it compares server Date with browser Date." />
              <Row label="Receive to Play" value="Intentional jitter buffer plus queued audio. If this is too high, the receiver buffer is too conservative." />
              <Row label="Interruption" value="Accumulated time where the audio context had already passed the next scheduled chunk start, meaning playback would have a gap." />
              <Row label="Queue" value="If it repeatedly falls near zero while chunks are still arriving, online jitter is exceeding the receiver buffer." />
            </dl>
          </div>
        </section>
      </section>
    </main>
  );
}

function Metric({
  label,
  value,
  detail,
  tone = "normal",
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: "normal" | "good" | "bad";
}) {
  const toneClass = tone === "good"
    ? "text-emerald-300"
    : tone === "bad"
      ? "text-red-300"
      : "text-neutral-100";
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.04] p-4">
      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-neutral-500">{label}</div>
      <div className={`mt-2 text-2xl font-semibold tabular-nums ${toneClass}`}>{value}</div>
      {detail ? <div className="mt-1 text-xs text-neutral-500">{detail}</div> : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-semibold text-neutral-200">{label}</dt>
      <dd className="mt-1 leading-6 text-neutral-400">{value}</dd>
    </div>
  );
}

function latencyTone(value: number | null, warnMs: number, badMs: number) {
  if (value == null) return "normal";
  if (value >= badMs) return "bad";
  if (value >= warnMs) return "normal";
  return "good";
}

function formatMs(value: number | null) {
  if (value == null) return "-";
  if (value < 1000) return `${value.toFixed(0)}ms`;
  return `${(value / 1000).toFixed(2)}s`;
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(2)}%`;
}

function formatBytes(value: number) {
  if (value < 1024) return `${value}B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)}KiB`;
  return `${(value / 1024 / 1024).toFixed(1)}MiB`;
}
