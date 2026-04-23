interface StatusAggregatesProps {
  activePages: Array<{
    id: string;
    canonicalUrl?: string;
    title?: string;
    sessionCount: number;
  }>;
  currentAppLabel: string;
  onlineCount: number;
}

export function StatusAggregates(props: StatusAggregatesProps) {
  return (
    <section className="space-y-6 text-left">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.34em] text-stone-400">
            Current
          </p>
        </div>
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <Metric label="Readers now" value={String(props.onlineCount)} />
        <Metric label="Active pages" value={String(props.activePages.length)} />
      </div>

      <div className="space-y-3">
        <p className="text-[11px] font-medium uppercase tracking-[0.28em] text-stone-400">
          Page concurrency
        </p>
        {props.activePages.length === 0 ? (
          <p className="text-[14px] leading-7 text-stone-500">
            No public content has active readers right now.
          </p>
        ) : (
          <div className="space-y-1">
            {props.activePages.map((page) => (
              <div
                key={page.id}
                className="flex items-center justify-between rounded-[1.25rem] border border-stone-200 bg-white/70 px-4 py-3"
              >
                <span className="truncate text-[14px] text-stone-700">
                  {page.title ?? page.canonicalUrl ?? page.id}
                </span>
                <span className="text-[14px] font-medium text-stone-950">
                  {page.sessionCount}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function Metric(props: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-medium uppercase tracking-[0.28em] text-stone-400">
        {props.label}
      </p>
      <p className="text-[18px] font-medium tracking-tight text-stone-950">
        {props.value}
      </p>
    </div>
  );
}
