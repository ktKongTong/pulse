import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import type { LiveListenAudioStats } from "@/lib/webrtc-audio-stats";
import { useLiveListenHost } from "./use-live-listen-host";

export function LiveListenHostPanel() {
  const [apiKey, setApiKey] = useState("");
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [forceTurnRelay, setForceTurnRelay] = useState(false);
  const hostDeviceId = useMemo(() => `web-host-${crypto.randomUUID()}`, []);
  const host = useLiveListenHost({ apiKey, audioFile, forceTurnRelay, hostDeviceId });
  const isLive = host.state === "live";
  const busy = host.state === "starting" || host.state === "stopping";

  return (
    <main className="min-h-screen bg-stone-950 px-6 py-10 text-stone-100">
      <section className="mx-auto flex max-w-2xl flex-col gap-6 rounded-3xl border border-white/10 bg-white/5 p-6 shadow-2xl">
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-emerald-300">Pulse Live Listen</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">Host audio publisher</h1>
          <p className="mt-2 text-sm text-stone-400">
            Upload an MP3 file, play it locally in this browser, then push that audio track to Cloudflare Realtime with PartyTracks.
          </p>
        </div>

        <label className="flex flex-col gap-2 text-sm">
          <span className="text-stone-300">Device API key</span>
          <input
            value={apiKey}
            onChange={(event) => setApiKey(event.currentTarget.value)}
            type="password"
            className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-stone-100 outline-none focus:border-emerald-400"
            placeholder="Bearer token used by Native device routes"
          />
        </label>

        <label className="flex flex-col gap-2 text-sm">
          <span className="text-stone-300">MP3 audio file</span>
          <input
            type="file"
            accept="audio/mpeg,audio/mp3,.mp3"
            disabled={busy || isLive}
            onChange={(event) => setAudioFile(event.currentTarget.files?.[0] ?? null)}
            className={cn(
              "rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-stone-100 outline-none file:mr-3 file:rounded-full file:border-0 file:bg-emerald-400 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-stone-950",
              "disabled:cursor-not-allowed disabled:opacity-50",
            )}
          />
          <span className="text-xs text-stone-500">
            {audioFile ? `${audioFile.name} · ${formatFileSize(audioFile.size)}` : "No file selected."}
          </span>
        </label>

        <label className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm">
          <span className="flex flex-col gap-1">
            <span className="text-stone-200">Force TURN relay</span>
            <span className="text-xs text-stone-500">Route WebRTC through Cloudflare TURN for A/B quality testing.</span>
          </span>
          <input
            type="checkbox"
            checked={forceTurnRelay}
            disabled={busy || isLive}
            onChange={(event) => setForceTurnRelay(event.currentTarget.checked)}
            className="size-5 accent-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
          />
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={busy || isLive || !audioFile}
            onClick={host.start}
            className={cn(
              "rounded-full px-4 py-2 text-sm font-medium uppercase tracking-[0.16em] transition",
              "bg-emerald-400 text-stone-950 enabled:hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            {host.state === "starting" ? "Starting" : "Start host"}
          </button>
          <button
            type="button"
            disabled={busy || !isLive}
            onClick={host.stop}
            className="rounded-full border border-white/15 px-4 py-2 text-sm font-medium uppercase tracking-[0.16em] text-stone-100 transition enabled:hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {host.state === "stopping" ? "Stopping" : "Stop"}
          </button>
          <span className="text-xs uppercase tracking-[0.22em] text-stone-400">{host.state}</span>
        </div>

        <div className="rounded-2xl bg-black/30 p-4 text-xs text-stone-300">
          <div>hostDeviceId: {hostDeviceId}</div>
          <div>forceTurnRelay: {forceTurnRelay ? "on" : "off"}</div>
          <div>audioFile: {audioFile?.name ?? "-"}</div>
          <div>sessionId: {host.trackMetadata?.sessionId ?? "-"}</div>
          <div>trackName: {host.trackMetadata?.trackName ?? "-"}</div>
          <div>mid: {host.trackMetadata?.mid ?? "-"}</div>
          <AudioStatsRows stats={host.audioStats} />
        </div>

        {host.error ? <p className="text-sm text-red-300">{host.error}</p> : null}
      </section>
    </main>
  );
}

function AudioStatsRows({ stats }: { stats: LiveListenAudioStats }) {
  return (
    <>
      <div>connection: {stats.connectionState ?? "-"}</div>
      <div>codec: {stats.codec ?? "-"}</div>
      <div>bitrate: {formatNullable(stats.bitrateKbps, " kbps", 1)}</div>
      <div>packets: {stats.packets ?? "-"}</div>
      <div>lost: {stats.packetsLost ?? "-"}</div>
      <div>jitter: {formatNullable(stats.jitterMs, " ms", 1)}</div>
      <div>rtt: {formatNullable(stats.roundTripTimeMs, " ms", 1)}</div>
    </>
  );
}

function formatNullable(value: number | null, suffix: string, digits: number) {
  return value === null ? "-" : `${value.toFixed(digits)}${suffix}`;
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const kib = bytes / 1024;
  if (kib < 1024) return `${kib.toFixed(1)} KB`;
  return `${(kib / 1024).toFixed(1)} MB`;
}
