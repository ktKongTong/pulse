import { cn } from "@/lib/utils";
import { useLiveListen } from "./use-live-listen";

export function LiveListenControl({ className }: { className?: string }) {
  const liveListen = useLiveListen();
  const state = liveListen.snapshot?.state ?? "offline";
  const isListening = liveListen.connectionState === "listening";
  const isConnected = liveListen.connectionState === "connected" || isListening;
  const disabled = !liveListen.canJoin || liveListen.connectionState === "joining";

  return (
    <div className={cn("flex items-center gap-2 text-xs", className)}>
      <audio ref={liveListen.audioRef} autoPlay playsInline />
      <button
        type="button"
        disabled={disabled}
        onClick={liveListen.join}
        className={cn(
          "rounded-full border border-stone-900/15 bg-white/70 px-3 py-1.5 font-medium uppercase tracking-[0.18em] text-stone-800 shadow-sm transition",
          "enabled:hover:bg-stone-950 enabled:hover:text-white disabled:cursor-not-allowed disabled:opacity-50",
          isConnected && "border-emerald-500/40 bg-emerald-50 text-emerald-700",
        )}
      >
        {liveListen.connectionState === "joining"
          ? "Joining"
          : isListening
            ? "Listening"
            : liveListen.connectionState === "connected"
              ? "Connected"
              : "Listen Live"}
      </button>
      <span className="text-[10px] uppercase tracking-[0.18em] text-stone-500">
        {state}
        {liveListen.snapshot ? ` · ${liveListen.snapshot.listenerCount}` : ""}
      </span>
      {liveListen.connectionState !== "idle" ? (
        <span
          className="text-[10px] uppercase tracking-[0.14em] text-stone-400"
          title={`codec=${liveListen.audioStats.codec ?? "-"}; jitter=${formatNullable(liveListen.audioStats.jitterMs, "ms")}; lost=${liveListen.audioStats.packetsLost ?? "-"}; rtt=${formatNullable(liveListen.audioStats.roundTripTimeMs, "ms")}`}
        >
          {formatNullable(liveListen.audioStats.bitrateKbps, "kbps")}
        </span>
      ) : null}
      {liveListen.error ? (
        <span className="max-w-44 truncate text-[10px] text-red-500" title={liveListen.error}>
          {liveListen.error}
        </span>
      ) : null}
    </div>
  );
}

function formatNullable(value: number | null, suffix: string) {
  return value === null ? "-" : `${value.toFixed(1)}${suffix}`;
}
