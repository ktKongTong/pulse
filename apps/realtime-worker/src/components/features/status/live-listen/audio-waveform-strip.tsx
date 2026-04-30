import { cn } from "@/lib/utils";
import type { WaveformPoint } from "./waveform-types";

export function AudioWaveformStrip(args: {
  currentPoint?: WaveformPoint | null;
  points: WaveformPoint[];
  className?: string;
  label: string;
  scaleMax: number;
  tone?: "emerald" | "sky";
}) {
  const toneClass = args.tone === "sky"
    ? { peak: "bg-sky-300/35", rms: "bg-sky-400/90" }
    : { peak: "bg-emerald-300/35", rms: "bg-emerald-400/90" };
  const current = args.currentPoint ?? args.points.at(-1) ?? { peak: 0, rms: 0, seq: 0, timestamp: 0 };
  const gain = 1 / args.scaleMax;

  return (
    <div className={cn("flex flex-col gap-2", args.className)}>
      <div className="flex items-center justify-between gap-3 text-[10px] font-medium uppercase tracking-[0.18em] text-stone-500">
        <span>{args.label}</span>
        <span className="text-stone-400">
          rms {formatLinear(current.rms)} · peak {formatLinear(current.peak)} · gain ×{gain.toFixed(1)}
        </span>
      </div>
      <div className="flex h-28 items-end gap-px rounded-xl border border-stone-900/10 bg-white/50 px-2 py-2">
        {args.points.length > 0
          ? args.points.map((point) => {
              const peakHeight = Math.max(6, Math.round((point.peak / args.scaleMax) * 100));
              const rmsHeight = Math.max(4, Math.round((point.rms / args.scaleMax) * 100));
              return (
                <div key={point.seq} className="relative flex min-w-0 flex-1 items-end justify-center self-stretch">
                  <div className={cn("w-full rounded-full", toneClass.peak)} style={{ height: `${peakHeight}%` }} />
                  <div className={cn("absolute bottom-0 w-full rounded-full", toneClass.rms)} style={{ height: `${rmsHeight}%` }} />
                </div>
              );
            })
          : (
              <div className="flex h-full w-full items-center justify-center text-[10px] uppercase tracking-[0.16em] text-stone-400">
                no signal
              </div>
            )}
      </div>
    </div>
  );
}

function formatLinear(value: number) {
  return value.toFixed(3);
}
