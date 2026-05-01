import { cn } from "@/lib/utils";
import { useLiveListen } from "./use-live-listen";
import { Button } from "@/components/ui/button";

export function LiveListenControl({ className }: { className?: string }) {
  const liveListen = useLiveListen();
  const isListening = liveListen.connectionState === "listening";
  const isConnected = liveListen.connectionState === "connected" || isListening;
  const disabled = liveListen.connectionState === "joining";

  return (
    <div className={cn("flex items-center gap-2 text-xs", className)}>
      <Button
        disabled={disabled}
        onClick={isConnected ? liveListen.leave : liveListen.join}
        variant={'link'}
        size={'xs'}
        className={cn(
          "",
          isConnected && "border-emerald-500/40 bg-emerald-50 text-emerald-700",
        )}
      >
        {liveListen.connectionState === "joining"
          ? "Joining"
          : isListening
            ? "Listening"
            : liveListen.connectionState === "connected"
              ? "Connected"
              : "一起听"}
      </Button>
      {liveListen.connectionState !== "idle" ? (
        <span
          className="text-[10px] uppercase tracking-[0.14em] text-stone-400"
          title={`queued=${liveListen.stats.queuedSeconds.toFixed(2)}s; bytes=${liveListen.stats.receivedBytes}; last=${liveListen.stats.lastChunkBytes}`}
        >
          {formatNullable(liveListen.stats.receiveBitrateKbps, "kbps")}
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
