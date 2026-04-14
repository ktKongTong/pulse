import { useEffect, useMemo, useState } from "react";
import type {
  DeviceAggregate,
  DeviceAggregateHistoryPoint,
  PageAggregate,
  PageAggregateHistoryPoint,
  RoomAggregate,
  RoomAggregateHistoryPoint,
  StatsPeriod,
  StatsSummary,
  StatsSummaryHistoryPoint,
} from "@pulse/realtime-protocol";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useStatusAggregateHistory } from "@pulse/realtime-react";

import { DeviceFocusChart } from "./device-focus-chart";
import { PageReadingChart } from "./page-reading-chart";
import { RoomActivityChart } from "./room-activity-chart";

interface StatusAggregateHistoryProps {
  deviceId?: string | null;
}

const PERIODS: Array<{
  value: Extract<StatsPeriod, "day" | "month" | "year">;
  label: string;
}> = [
  { value: "day", label: "Day" },
  { value: "month", label: "Month" },
  { value: "year", label: "Year" },
];

export function StatusAggregateHistory(props: StatusAggregateHistoryProps) {
  const [period, setPeriod] =
    useState<Extract<StatsPeriod, "day" | "month" | "year">>("day");
  const history = useStatusAggregateHistory({
    deviceId: props.deviceId,
    period,
  });

  const buckets = useMemo(
    () =>
      mergeBuckets(
        history.global,
        history.pages,
        history.rooms,
        history.device,
      ),
    [history.device, history.global, history.pages, history.rooms],
  );

  const [selectedBucketKey, setSelectedBucketKey] = useState<string | null>(
    null,
  );

  useEffect(() => {
    setSelectedBucketKey((current) => {
      if (buckets.length === 0) return null;
      if (current && buckets.some((bucket) => bucket.key === current))
        return current;
      return buckets[0]?.key ?? null;
    });
  }, [buckets]);

  const selectedBucket =
    buckets.find((bucket) => bucket.key === selectedBucketKey) ?? null;
  const selectedGlobal = findGlobal(history.global, selectedBucketKey);
  const selectedPages = findItems(history.pages, selectedBucketKey);
  const selectedRooms = findItems(history.rooms, selectedBucketKey);
  const selectedDevice = findDevice(history.device, selectedBucketKey);

  return (
    <section className="space-y-6 text-left">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.34em] text-stone-400">
            History
          </p>
          <p className="mt-2 max-w-2xl text-[14px] leading-7 text-stone-500">
            Review retained aggregate buckets across recent days, months, and
            years without breaking the live status layout.
          </p>
        </div>

        <Tabs
          value={period}
          onValueChange={(value) => {
            if (value === "day" || value === "month" || value === "year") {
              setPeriod(value);
            }
          }}
          className="gap-0"
        >
          <TabsList
            variant="line"
            className="w-fit justify-start gap-5 border-b border-stone-200/80 p-0 pb-2"
          >
            {PERIODS.map((item) => (
              <TabsTrigger
                key={item.value}
                value={item.value}
                className="px-0 text-[12px] uppercase tracking-[0.26em]"
              >
                {item.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {history.error ? (
        <p className="text-[13px] leading-6 text-stone-500">
          Aggregate history temporarily unavailable: {history.error}
        </p>
      ) : null}

      {buckets.length === 0 && !history.loading ? (
        <p className="text-[14px] leading-7 text-stone-500">
          No retained aggregate buckets are available for this period yet.
        </p>
      ) : null}

      {history.loading ? (
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
                    {periodLabel(period)}
                  </span>
                  <span className="mt-1 block text-[13px] font-medium tracking-tight">
                    {bucket.label}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="grid gap-6 border-t border-stone-200/80 pt-8 sm:grid-cols-3">
            <Metric
              label="Selected range"
              value={selectedBucket?.label ?? "—"}
              hint={
                selectedBucket
                  ? `${selectedBucket.startDay} → ${selectedBucket.endDay}`
                  : undefined
              }
            />
            <Metric
              label="Peak online"
              value={String(selectedGlobal?.onlineCountPeak ?? 0)}
              hint="From retained room snapshots"
            />
            <Metric
              label="Avg online"
              value={formatAverage(selectedGlobal?.avgOnlineCount ?? 0)}
              hint="Integral-derived occupancy"
            />
          </div>

          <div className="space-y-2">
            <p className="text-[11px] font-medium uppercase tracking-[0.28em] text-stone-400">
              Bucket overview
            </p>
            <p className="text-[14px] leading-7 text-stone-500">
              {buildOverviewCopy(
                period,
                selectedBucket,
                selectedGlobal,
                selectedPages,
                selectedRooms,
              )}
            </p>
          </div>

          <StatusAggregateHistoryTabs
            global={selectedGlobal}
            device={selectedDevice}
            pages={selectedPages}
            rooms={selectedRooms}
          />
        </>
      ) : null}
    </section>
  );
}

function StatusAggregateHistoryTabs(props: {
  global: StatsSummary | null;
  device: DeviceAggregate | null;
  pages: PageAggregate[];
  rooms: RoomAggregate[];
}) {
  const defaultTab = props.device ? "device" : "rooms";

  return (
    <Tabs defaultValue={defaultTab} className="gap-6">
      <TabsList
        variant="line"
        className="w-full justify-start gap-5 border-b border-stone-200/80 p-0 pb-2"
      >
        <TabsTrigger
          value="device"
          className="px-0 text-[12px] uppercase tracking-[0.26em]"
        >
          Device
        </TabsTrigger>
        <TabsTrigger
          value="rooms"
          className="px-0 text-[12px] uppercase tracking-[0.26em]"
        >
          Rooms
        </TabsTrigger>
        <TabsTrigger
          value="pages"
          className="px-0 text-[12px] uppercase tracking-[0.26em]"
        >
          Pages
        </TabsTrigger>
      </TabsList>

      <TabsContent value="device" className="space-y-7">
        <DeviceFocusChart aggregate={props.device} />
      </TabsContent>

      <TabsContent value="rooms" className="space-y-7">
        <RoomActivityChart global={props.global} rooms={props.rooms} />
      </TabsContent>

      <TabsContent value="pages" className="space-y-7">
        <PageReadingChart pages={props.pages} />
      </TabsContent>
    </Tabs>
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

function mergeBuckets(
  global: StatsSummaryHistoryPoint[],
  pages: PageAggregateHistoryPoint[],
  rooms: RoomAggregateHistoryPoint[],
  device: DeviceAggregateHistoryPoint[],
) {
  const merged = new Map<
    string,
    {
      key: string;
      label: string;
      startDay: string;
      endDay: string;
    }
  >();

  for (const point of [...global, ...pages, ...rooms, ...device]) {
    merged.set(point.bucket.key, {
      key: point.bucket.key,
      label: point.bucket.label,
      startDay: point.bucket.startDay,
      endDay: point.bucket.endDay,
    });
  }

  return Array.from(merged.values()).sort((left, right) =>
    left.key < right.key ? 1 : -1,
  );
}

function findGlobal(
  points: StatsSummaryHistoryPoint[],
  bucketKey: string | null,
): StatsSummary | null {
  if (!bucketKey) return null;
  return points.find((point) => point.bucket.key === bucketKey)?.value ?? null;
}

function findItems<T extends { bucket: { key: string }; items: unknown[] }>(
  points: T[],
  bucketKey: string | null,
) {
  if (!bucketKey) return [] as T["items"];
  return (points.find((point) => point.bucket.key === bucketKey)?.items ??
    []) as T["items"];
}

function findDevice(
  points: DeviceAggregateHistoryPoint[],
  bucketKey: string | null,
): DeviceAggregate | null {
  if (!bucketKey) return null;
  return points.find((point) => point.bucket.key === bucketKey)?.value ?? null;
}

function periodLabel(period: Extract<StatsPeriod, "day" | "month" | "year">) {
  if (period === "day") return "Daily";
  if (period === "month") return "Monthly";
  return "Yearly";
}

function buildOverviewCopy(
  period: Extract<StatsPeriod, "day" | "month" | "year">,
  bucket: { label: string; startDay: string; endDay: string } | null,
  global: StatsSummary | null,
  pages: PageAggregate[],
  rooms: RoomAggregate[],
) {
  if (!bucket) {
    return "Select a retained bucket to inspect aggregate detail.";
  }

  const pageCount = pages.length;
  const roomCount = rooms.filter((room) => room.roomId !== "global").length;
  const providerCount = global?.mediaActiveSecondsByProvider.length ?? 0;

  return [
    `${periodLabel(period)} bucket ${bucket.label} covers ${bucket.startDay} → ${bucket.endDay}.`,
    `Peak online reached ${global?.onlineCountPeak ?? 0}.`,
    `${pageCount} page aggregates and ${roomCount} room aggregates are available.`,
    providerCount > 0
      ? `${providerCount} media providers recorded activity.`
      : "No media provider activity was recorded in this bucket.",
  ].join(" ");
}

function formatAverage(value: number) {
  if (!Number.isFinite(value)) return "0.00";
  return value.toFixed(2);
}
