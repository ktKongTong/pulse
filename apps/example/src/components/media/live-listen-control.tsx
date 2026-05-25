import { Podcast } from "lucide-react";
import { useStreamControl } from "@ktfun/pulse";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { unlockAudioStream } from "../../lib/audio-stream-player";

export function StreamControl({ className }: { className?: string }) {

  const { streamable, streaming, disabled, requestStream, stopStream } =
    useStreamControl({ unlockAudio: unlockAudioStream })

  const toggleStream = () => {
    if (streaming) stopStream()
    else requestStream()
  }

  return (
    <div className={cn("flex items-center gap-2 text-xs", className)}>
      <Tooltip>
        <TooltipTrigger
          className={disabled ? "" : "cursor-pointer"}
          render={
            <Button
              className={cn(streaming && "text-emerald-700")}
              disabled={disabled}
              onClick={toggleStream}
              variant="link"
              size="icon-sm"
            >
              <Podcast />
            </Button>
          }
        />
        <TooltipContent>
          {!streaming && streamable ? (
            <span className="text-[10px] uppercase tracking-[0.14em] text-stone-400">
              一起听
            </span>
          ) : null}
          {streaming ? (
            <span className="text-[10px] uppercase tracking-[0.14em] text-stone-400">
              streaming
            </span>
          ) : null}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
