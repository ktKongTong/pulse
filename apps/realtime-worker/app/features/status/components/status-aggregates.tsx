import type {
  DeviceAggregate,
  PageAggregate,
  RoomAggregate,
  StatsSummary,
} from "@pulse/realtime-protocol";

import { StatusAggregateTabs } from "./status-aggregate-tabs";

interface StatusAggregatesProps {
  day: string;
  global: StatsSummary | null;
  device: DeviceAggregate | null;
  pages: PageAggregate[];
  rooms: RoomAggregate[];
  loading: boolean;
  error: string | null;
}

export function StatusAggregates(props: StatusAggregatesProps) {
  return (
    <section className="space-y-6 text-left">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.34em] text-stone-400">
            Today
          </p>
          <p className="mt-2 text-[14px] leading-7 text-stone-500">
            Live device, room, and reading rollups for {props.day}.
          </p>
        </div>
        {props.loading ? (
          <p className="text-[11px] font-medium uppercase tracking-[0.28em] text-stone-400">
            Waiting for stats
          </p>
        ) : null}
      </div>

      {props.error ? (
        <p className="text-[13px] leading-6 text-stone-500">
          Stats temporarily unavailable: {props.error}
        </p>
      ) : null}

      <StatusAggregateTabs
        global={props.global}
        device={props.device}
        pages={props.pages}
        rooms={props.rooms}
      />
    </section>
  );
}
