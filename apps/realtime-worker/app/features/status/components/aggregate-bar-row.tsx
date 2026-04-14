interface AggregateBarRowProps {
  label: string;
  value: string;
  caption?: string;
  percent: number;
  secondaryPercent?: number;
}

export function AggregateBarRow(props: AggregateBarRowProps) {
  return (
    <div className="space-y-2.5 py-2">
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="truncate text-[15px] font-medium tracking-tight text-stone-950">
            {props.label}
          </p>
          {props.caption ? (
            <p className="mt-1 truncate text-[12px] leading-5 text-stone-400">
              {props.caption}
            </p>
          ) : null}
        </div>
        <p className="shrink-0 text-[12px] font-medium uppercase tracking-[0.18em] text-stone-500">
          {props.value}
        </p>
      </div>

      <div className="space-y-1.5">
        <div className="h-[2px] w-full overflow-hidden rounded-full bg-stone-200/70">
          <div
            className="h-full rounded-full bg-stone-900 transition-[width] duration-500 ease-out"
            style={{ width: `${clampPercent(props.percent)}%` }}
          />
        </div>
        {props.secondaryPercent !== undefined ? (
          <div className="h-[2px] w-full overflow-hidden rounded-full bg-stone-200/40">
            <div
              className="h-full rounded-full bg-stone-400/70 transition-[width] duration-500 ease-out"
              style={{ width: `${clampPercent(props.secondaryPercent)}%` }}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
}
