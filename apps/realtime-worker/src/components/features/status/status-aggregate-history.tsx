import { useEffect, useState } from "react";
import type { StatsPeriod } from "@pulse/realtime-protocol";

import { DeviceFocusChart } from "./hero/focus/device-focus-chart";
import { useOwnerStats, useSiteStats } from "@pulse/realtime-react";

const PERIODS: StatsPeriod[] = ["day", "month", "year"];

export function StatusAggregateHistory() {
  const [period] = useState<StatsPeriod>("day");
  const [selectedBucketKey, setSelectedBucketKey] = useState<string | null>(null);
  const site = useSiteStats({ period });
  const owner = useOwnerStats({ period });
  const buckets = mergeBuckets(site.history, owner.history);

  useEffect(() => {
    setSelectedBucketKey((current) => {
      if (current && buckets.some((bucket) => bucket.key === current)) return current;
      return buckets[0]?.key ?? null;
    });
  }, [buckets]);

  const selectedSite =
    site.history.find((point) => point.bucket.key === selectedBucketKey)?.value ??
    site.lifetime;
  const selectedOwner =
    owner.history.find((point) => point.bucket.key === selectedBucketKey)?.value ??
    owner.lifetime;
  const loading = site.loading || owner.loading;
  const error = site.error ?? owner.error;

  return (
    <section className="space-y-6 px-4 sm:px-6 md:px-10 pt-10 pb-6 py-4 text-left w-full max-w-2xl">
      {buckets.length > 0 ? (
        <>
          <div className="grid gap-6 grid-cols-3">
            <Metric label="PV" value={String(selectedSite?.pv ?? 0)} />
            <Metric label="UV" value={String(selectedSite?.uv ?? 0)} />
            <Metric label="Read time" value={selectedSite?.readTimeLabel ?? "0s"} />
          </div>
          <DeviceFocusChart aggregate={selectedOwner} />
        </>
      ) : null}
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

function mergeBuckets(
  site: Array<{ bucket: { key: string; label: string; startDay: string; endDay: string; period: StatsPeriod } }>,
  owner: Array<{ bucket: { key: string; label: string; startDay: string; endDay: string; period: StatsPeriod } }>,
) {
  const merged = new Map<string, (typeof site)[number]["bucket"]>();

  for (const point of [...site, ...owner]) {
    merged.set(point.bucket.key, point.bucket);
  }

  return [...merged.values()].sort((left, right) => (left.key < right.key ? 1 : -1));
}
