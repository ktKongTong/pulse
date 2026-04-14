import type { PageAggregate } from "@pulse/realtime-protocol";

import { AggregateBarRow } from "./aggregate-bar-row";

export function PageReadingChart(props: { pages: PageAggregate[] }) {
  const maxReaderOnlineSeconds = Math.max(
    ...props.pages.map((page) => page.readerOnlineSeconds),
    0
  );

  if (props.pages.length === 0) {
    return <EmptyCopy text="No reading aggregate has been collected yet." />;
  }

  return (
    <div className="space-y-3">
      <p className="text-[11px] font-medium uppercase tracking-[0.28em] text-stone-400">
        Top pages by reader-online time
      </p>
      <div className="space-y-1">
        {props.pages.map((page) => (
          <AggregateBarRow
            key={page.canonicalUrl}
            label={page.title}
            caption={`${page.pageViewCount} views · avg ${Math.round(page.avgProgressPercent)}%`}
            value={formatDuration(page.readerOnlineSeconds)}
            percent={relativePercent(page.readerOnlineSeconds, maxReaderOnlineSeconds)}
            secondaryPercent={page.avgProgressPercent}
          />
        ))}
      </div>
      <p className="text-[12px] leading-6 text-stone-400">
        Primary rail = reader-online time. Secondary rail = average reading progress.
      </p>
    </div>
  );
}

function EmptyCopy(props: { text: string }) {
  return <p className="text-[14px] leading-7 text-stone-500">{props.text}</p>;
}

function formatDuration(totalSeconds: number) {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  if (minutes > 0) return `${minutes}m ${String(remainingSeconds).padStart(2, "0")}s`;
  return `${remainingSeconds}s`;
}

function relativePercent(value: number, max: number) {
  if (max <= 0) return 0;
  return (value / max) * 100;
}
