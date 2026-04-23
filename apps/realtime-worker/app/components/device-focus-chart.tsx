import type { OwnerStats } from "@pulse/realtime-react";

import { AggregateBarRow } from "@/components/aggregate-bar-row";

export function DeviceFocusChart(props: { aggregate: OwnerStats | null }) {
  const aggregate = props.aggregate;
  if (!aggregate) {
    return <EmptyCopy text="No owner aggregate has been materialized yet." />;
  }

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <SectionLabel title="App used today" />
        <div className="space-y-1">
          {aggregate.apps.slice(0, 5).map((item) => (
            <AggregateBarRow
              key={item.key}
              label={item.label}
              value={item.totalFocusLabel}
              percent={item.sharePercent}
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
