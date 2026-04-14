import type { DeviceAggregate } from "@pulse/realtime-protocol";

import { AggregateBarRow } from "./aggregate-bar-row";

export function DeviceFocusChart(props: { aggregate: DeviceAggregate | null }) {
  const aggregate = props.aggregate;
  if (!aggregate) {
    return <EmptyCopy text="No device aggregate has been materialized for the active device yet." />;
  }

  const totalFocusSeconds = aggregate.appFocus.reduce((sum, item) => sum + item.totalSeconds, 0);
  const totalMediaSeconds = aggregate.mediaPlayback.reduce((sum, item) => sum + item.totalSeconds, 0);

  return (
    <div className="space-y-8">
      <div className="grid gap-6 sm:grid-cols-3">
        <Metric label="Focus switches" value={String(aggregate.focusSwitchCount)} />
        <Metric label="Media switches" value={String(aggregate.mediaSwitchCount)} />
        <Metric label="Sessions" value={String(aggregate.sessionCount)} />
      </div>

      <div className="space-y-3">
        <SectionLabel title="Top app focus share" />
        <div className="space-y-1">
          {aggregate.appFocus.slice(0, 5).map((item) => (
            <AggregateBarRow
              key={item.key}
              label={item.label}
              caption={`${share(item.totalSeconds, totalFocusSeconds)} of device focus`}
              value={formatDuration(item.totalSeconds)}
              percent={sharePercent(item.totalSeconds, totalFocusSeconds)}
            />
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <SectionLabel title="Media playback share" />
        {aggregate.mediaPlayback.length === 0 ? (
          <EmptyCopy text="No media playback aggregate has been collected yet." />
        ) : (
          <div className="space-y-1">
            {aggregate.mediaPlayback.slice(0, 4).map((item) => (
              <AggregateBarRow
                key={`${item.providerId}:${item.trackId ?? item.title ?? "media"}`}
                label={item.title ?? item.trackId ?? item.providerId}
                caption={`${item.providerId} · ${share(item.totalSeconds, totalMediaSeconds)} of playback`}
                value={formatDuration(item.totalSeconds)}
                percent={sharePercent(item.totalSeconds, totalMediaSeconds)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
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
