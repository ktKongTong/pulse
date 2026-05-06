import { cn } from "@/lib/utils";
import { useLiveListen } from "./use-live-listen";
import { Button } from "@/components/ui/button";

export function LiveListenControl({ className }: { className?: string }) {
  const liveListen = useLiveListen();
  const disabled = liveListen.command === "joining" || (!liveListen.streaming && !liveListen.canJoin);

  return (
    <div className={cn("flex items-center gap-2 text-xs", className)}>
      <Button
        disabled={disabled}
        onClick={liveListen.streaming ? liveListen.leave : liveListen.join}
        variant={'link'}
        size={'xs'}
        className={cn(
          "",
          liveListen.streaming && "border-emerald-500/40 bg-emerald-50 text-emerald-700",
        )}
      >
        {liveListen.command === "joining"
          ? "Joining"
          : liveListen.streaming
            ? "Listening"
            : liveListen.ws === "half-off"
              ? "Reconnecting"
              : "一起听"}
      </Button>
      {liveListen.streaming || liveListen.ws !== "off" ? (
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
