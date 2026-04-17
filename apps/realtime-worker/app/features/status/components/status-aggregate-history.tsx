import { useEffect, useMemo, useState } from "react";
import type {
  OwnerHistoryPoint,
  OwnerMetrics,
  SiteHistoryPoint,
  SiteMetrics,
  StatsPeriod,
} from "@pulse/realtime-protocol";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useOwnerHistory, useSiteHistory } from "@pulse/realtime-react";

import { DeviceFocusChart } from "./device-focus-chart";

const PERIODS: StatsPeriod[] = ["day", "month", "year"];

export function StatusAggregateHistory() {
  const [period, setPeriod] = useState<StatsPeriod>("day");
  const siteHistory = useSiteHistory({ period });
  const ownerHistory = useOwnerHistory({ period });

  const buckets = useMemo(
    () => mergeBuckets(siteHistory.data, ownerHistory.data),
    [ownerHistory.data, siteHistory.data],
  );
  const [selectedBucketKey, setSelectedBucketKey] = useState<string | null>(null);

  useEffect(() => {
    setSelectedBucketKey((current) => {
      if (buckets.length === 0) return null;
      if (current && buckets.some((bucket) => bucket.key === current)) return current;
      return buckets[0]?.key ?? null;
    });
  }, [buckets]);

  const selectedBucket = buckets.find((bucket) => bucket.key === selectedBucketKey) ?? null;
  const selectedSite = findSite(siteHistory.data, selectedBucketKey);
  const selectedOwner = findOwner(ownerHistory.data, selectedBucketKey);

  const loading = siteHistory.loading || ownerHistory.loading;
  const error = siteHistory.error ?? ownerHistory.error;

  return (
    <section className="space-y-6 text-left">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.34em] text-stone-400">
            History
          </p>
          <p className="mt-2 max-w-2xl text-[14px] leading-7 text-stone-500">
            Review recent site attention and owner activity without mixing them into realtime state.
          </p>
        </div>

        <Tabs value={period} onValueChange={(value) => setPeriod(value as StatsPeriod)} className="gap-0">
          <TabsList variant="line" className="w-fit justify-start gap-5 border-b border-stone-200/80 p-0 pb-2">
            {PERIODS.map((item) => (
              <TabsTrigger key={item} value={item} className="px-0 text-[12px] uppercase tracking-[0.26em]">
                {item}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {error ? (
        <p className="text-[13px] leading-6 text-stone-500">
          Aggregate history temporarily unavailable: {error}
        </p>
      ) : null}

      {loading ? (
        <p className="text-[11px] font-medium uppercase tracking-[0.28em] text-stone-400">
          Loading retained aggregates
        </p>
      ) : null}

      {buckets.length > 0 ? (
        <>
          <div className="flex flex-wrap gap-2.5">
            {buckets.map((bucket) => {
              const active = bucket.key === selectedBucketKey;
              return (
                <button
                  key={bucket.key}
                  type="button"
                  onClick={() => setSelectedBucketKey(bucket.key)}
                  className={[
                    "rounded-full border px-3 py-1.5 text-left transition-colors",
                    active
                      ? "border-stone-900 bg-stone-900 text-[#f8f5ef]"
                      : "border-stone-200 bg-white/70 text-stone-600 hover:border-stone-300 hover:text-stone-900",
                  ].join(" ")}
                >
                  <span className="block text-[10px] font-medium uppercase tracking-[0.24em] opacity-70">
                    {period}
                  </span>
                  <span className="mt-1 block text-[13px] font-medium tracking-tight">
                    {bucket.label}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="grid gap-6 border-t border-stone-200/80 pt-8 sm:grid-cols-4">
            <Metric label="PV" value={String(selectedSite?.pv ?? 0)} hint="Content opens in this bucket" />
            <Metric label="UV" value={String(selectedSite?.uv ?? 0)} hint="Distinct visitor sessions in this bucket" />
            <Metric
              label="Read time"
              value={formatDuration(selectedSite?.readTimeSeconds ?? 0)}
              hint="Accumulated effective reading time"
            />
            <Metric
              label="Active apps"
              value={String(selectedOwner?.appPresenceSecondsByApp.length ?? 0)}
              hint="Owner apps observed in this bucket"
            />
          </div>

          <Tabs defaultValue="owner" className="gap-6">
            <TabsList variant="line" className="w-full justify-start gap-5 border-b border-stone-200/80 p-0 pb-2">
              <TabsTrigger value="site" className="px-0 text-[12px] uppercase tracking-[0.26em]">
                Site
              </TabsTrigger>
              <TabsTrigger value="owner" className="px-0 text-[12px] uppercase tracking-[0.26em]">
                Owner
              </TabsTrigger>
            </TabsList>

            <TabsContent value="site" className="space-y-4">
              <p className="text-[14px] leading-7 text-stone-500">
                {selectedBucket
                  ? `${selectedBucket.label} covers ${selectedBucket.startDay} → ${selectedBucket.endDay}. The site received ${selectedSite?.pv ?? 0} opens, ${selectedSite?.uv ?? 0} visitor sessions, and accumulated ${formatDuration(selectedSite?.readTimeSeconds ?? 0)} of read time.`
                  : "Select a retained bucket to inspect aggregate detail."}
              </p>
            </TabsContent>

            <TabsContent value="owner" className="space-y-7">
              <DeviceFocusChart aggregate={selectedOwner} />
            </TabsContent>
          </Tabs>
        </>
      ) : null}
    </section>
  );
}

function Metric(props: { label: string; value: string; hint?: string }) {
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-medium uppercase tracking-[0.28em] text-stone-400">
        {props.label}
      </p>
      <p className="text-[18px] font-medium tracking-tight text-stone-950">
        {props.value}
      </p>
      {props.hint ? (
        <p className="text-[12px] leading-6 text-stone-400">{props.hint}</p>
      ) : null}
    </div>
  );
}

function mergeBuckets(site: SiteHistoryPoint[], owner: OwnerHistoryPoint[]) {
  const merged = new Map<string, { key: string; label: string; startDay: string; endDay: string }>();
  for (const point of [...site, ...owner]) {
    merged.set(point.bucket.key, {
      key: point.bucket.key,
      label: point.bucket.label,
      startDay: point.bucket.startDay,
      endDay: point.bucket.endDay,
    });
  }
  return [...merged.values()].sort((left, right) => (left.key < right.key ? 1 : -1));
}

function findSite(points: SiteHistoryPoint[], bucketKey: string | null): SiteMetrics | null {
  if (!bucketKey) return null;
  return points.find((point) => point.bucket.key === bucketKey)?.value ?? null;
}

function findOwner(points: OwnerHistoryPoint[], bucketKey: string | null): OwnerMetrics | null {
  if (!bucketKey) return null;
  return points.find((point) => point.bucket.key === bucketKey)?.value ?? null;
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
