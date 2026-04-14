import type { RoomAggregate, StatsSummary } from "@pulse/realtime-protocol";

import { AggregateBarRow } from "./aggregate-bar-row";

export function RoomActivityChart(props: {
  global: StatsSummary | null;
  rooms: RoomAggregate[];
}) {
  const rooms = props.rooms.filter((room) => room.roomId !== "global").slice(0, 5);
  const maxBusyRoom = Math.max(...rooms.map((room) => room.roomOnlineSecondsIntegral), 0);
  const maxProvider = Math.max(
    ...(props.global?.mediaActiveSecondsByProvider ?? []).map((item) => item.totalSeconds),
    0
  );
  const maxAppPresence = Math.max(
    ...(props.global?.devicePresenceSecondsByApp ?? []).map((item) => item.totalSeconds),
    0
  );

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <SectionLabel title="Media activity by provider" />
        {(props.global?.mediaActiveSecondsByProvider?.length ?? 0) === 0 ? (
          <EmptyCopy text="No media-active rollup yet." />
        ) : (
          <div className="space-y-1">
            {(props.global?.mediaActiveSecondsByProvider ?? []).slice(0, 4).map((item) => (
              <AggregateBarRow
                key={item.key}
                label={item.label}
                caption={`${item.count} aggregate ticks`}
                value={formatDuration(item.totalSeconds)}
                percent={relativePercent(item.totalSeconds, maxProvider)}
              />
            ))}
          </div>
        )}
      </div>

      <div className="space-y-3">
        <SectionLabel title="Device presence by app" />
        {(props.global?.devicePresenceSecondsByApp?.length ?? 0) === 0 ? (
          <EmptyCopy text="No device presence rollup yet." />
        ) : (
          <div className="space-y-1">
            {(props.global?.devicePresenceSecondsByApp ?? []).slice(0, 5).map((item) => (
              <AggregateBarRow
                key={item.key}
                label={item.label}
                caption={`${item.count} presence buckets`}
                value={formatDuration(item.totalSeconds)}
                percent={relativePercent(item.totalSeconds, maxAppPresence)}
              />
            ))}
          </div>
        )}
      </div>

      <div className="space-y-3">
        <SectionLabel title="Busy rooms" />
        {rooms.length === 0 ? (
          <EmptyCopy text="No page room aggregate has been recorded yet." />
        ) : (
          <div className="space-y-1">
            {rooms.map((room) => (
              <AggregateBarRow
                key={room.roomId}
                label={room.roomId.replace(/^page:/, "")}
                caption={`${room.uniqueReaderSessions} sessions`}
                value={formatDuration(room.roomOnlineSecondsIntegral)}
                percent={relativePercent(room.roomOnlineSecondsIntegral, maxBusyRoom)}
              />
            ))}
          </div>
        )}
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

function relativePercent(value: number, max: number) {
  if (max <= 0) return 0;
  return (value / max) * 100;
}
