import { cn } from "@/lib/utils";
import { useLiveListen } from "./use-live-listen";
import { Button } from "@/components/ui/button";
import { Podcast } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function LiveListenControl({ className }: { className?: string }) {
  const liveListen = useLiveListen();
  const disabled = liveListen.command === "joining" || (!liveListen.streaming && !liveListen.canJoin);
  return (
    <div className={cn("flex items-center gap-2 text-xs", className)}>
      <Tooltip>
        <TooltipTrigger
        className={disabled ? '' : 'cursor-pointer'}
          render={
            <Button
              className={
                cn(
                  liveListen.streaming && "text-emerald-700",
                )
            }
              disabled={disabled}
              onClick={liveListen.streaming ? liveListen.leave : liveListen.join}
              variant={'link'} size={'icon-sm'}
            >
              <Podcast/>
            </Button>
          }
          />
        <TooltipContent>
          {
            !liveListen.streaming && liveListen.streamable && (
              <span
                className="text-[10px] uppercase tracking-[0.14em] text-stone-400"
              >
                {"一起听"}
              </span>
            )
          }
          {liveListen.streaming && liveListen.ws !== "off" ? (
            <span
              className="text-[10px] uppercase tracking-[0.14em] text-stone-400"
            >
              {formatNullable(liveListen.stats.receiveBitrateKbps, "kbps")}
            </span>
          ) : null}
          {liveListen.error ? (
            <span className="max-w-44 truncate text-[10px] text-destructive" title={liveListen.error}>
              {liveListen.error}
            </span>
          ) : null}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}



function formatNullable(value: number | null, suffix: string) {
  return value === null ? "-" : `${value.toFixed(1)}${suffix}`;
}
