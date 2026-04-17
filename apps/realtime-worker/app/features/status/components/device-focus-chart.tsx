import type { OwnerMetrics } from "@pulse/realtime-protocol";

import { AggregateBarRow } from "./aggregate-bar-row";

export function DeviceFocusChart(props: { aggregate: OwnerMetrics | null }) {
  const aggregate = props.aggregate;
  if (!aggregate) {
    return <EmptyCopy text="No owner aggregate has been materialized yet." />;
  }

  const totalFocusSeconds = aggregate.appPresenceSecondsByApp.reduce(
    (sum, item) => sum + item.totalSeconds,
    0,
  );

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <SectionLabel title="App presence history" />
        <div className="space-y-1">
          {aggregate.appPresenceSecondsByApp.slice(0, 5).map((item) => (
            <AggregateBarRow
              key={item.key}
              label={item.label}
              caption={`${share(item.totalSeconds, totalFocusSeconds)} of owner presence`}
              value={formatDuration(item.totalSeconds)}
              percent={sharePercent(item.totalSeconds, totalFocusSeconds)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function SectionLabel(props: { title: string }) {
  return (
    <p className="text-[11px] font-medium uppercase tracking-[0.28em] text-stone-400">
      {props.title}
    </p>
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

function share(value: number, total: number) {
  if (total <= 0) return "0%";
  return `${Math.round((value / total) * 100)}%`;
}

function sharePercent(value: number, total: number) {
  if (total <= 0) return 0;
  return (value / total) * 100;
}
