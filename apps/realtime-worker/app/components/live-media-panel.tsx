import type { RoomReader } from "@pulse/realtime-protocol";
import {
  formatClock,
  resolveDisplayedProgressSeconds,
  resolveProgressPercent,
  useNowTick,
} from "@pulse/realtime-react";

export function LiveMediaPanel(props: { readers: RoomReader[]; title?: string; subtitle?: string }) {
  const mediaReaders = props.readers.filter((reader) => reader.media?.title);
  const now = useNowTick();

  return (
    <section className="overflow-hidden rounded-[2rem] border border-white/80 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 p-6 text-white shadow-[0_32px_90px_rgba(15,23,42,0.18)]">
      <div className="flex items-start justify-between gap-6">
        <div className="space-y-2">
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.28em] text-emerald-300/80">{props.title ?? "Live media"}</p>
          <h2 className="font-display text-3xl font-bold tracking-tight">Now playing</h2>
          <p className="max-w-2xl text-sm leading-6 text-slate-300">
            {props.subtitle ?? "Current media sessions carried by device presence."}
          </p>
        </div>
      </div>

      {mediaReaders.length === 0 ? (
        <p className="mt-6 text-sm text-slate-400">No active media sessions in the global room.</p>
      ) : (
        <div className="mt-6 space-y-4">
          {mediaReaders.map((reader) => (
            <LiveMediaRow
              key={`${reader.readerId}:${reader.media?.title ?? "media"}`}
              reader={reader}
              now={now}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function LiveMediaRow(props: { reader: RoomReader; now: number }) {
  const media = props.reader.media!;
  const displayedProgress = resolveDisplayedProgressSeconds(
    media,
    props.reader.updatedAt,
    props.now,
  );
  const durationSeconds = media.durationSeconds ?? 0;
  const progressPercent = resolveProgressPercent(displayedProgress, durationSeconds);
  const subtitle = [
    media.artist,
    media.album,
    media.albumArtist ? `album artist: ${media.albumArtist}` : null
  ].filter(Boolean).join(" · ");
  const indexParts = [
    media.trackNumber ? `track ${media.trackNumber}` : null,
    media.discNumber ? `disc ${media.discNumber}` : null,
    media.itemType ? `type ${media.itemType}` : null
  ].filter(Boolean).join(" · ");

  return (
    <article className="grid gap-5 rounded-[1.6rem] border border-white/10 bg-white/[0.05] p-5 backdrop-blur-sm md:grid-cols-[96px_minmax(0,1fr)]">
      <div className="h-24 w-24 overflow-hidden rounded-[1.3rem] border border-white/10 bg-white/[0.06]">
        {media.artworkUrl ? (
          <img className="h-full w-full object-cover" src={media.artworkUrl} alt={media.title ?? "Artwork"} />
        ) : (
          <div className="flex h-full items-center justify-center text-3xl text-white/70">♪</div>
        )}
      </div>

      <div className="min-w-0">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-2xl font-semibold tracking-tight text-white">{media.title ?? "Unknown track"}</h3>
            <p className="mt-2 text-sm leading-6 text-slate-300">{subtitle || "No artist or album metadata"}</p>
          </div>
          <div className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-2 text-right text-xs uppercase tracking-[0.18em] text-emerald-200">
            <div>{media.playbackState ?? media.source ?? "media"}</div>
            <div className="mt-1 text-[10px] tracking-[0.24em] text-slate-400">{props.reader.displayName}</div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <DetailPill label="Provider" value={media.providerId ?? media.source ?? "unknown"} />
          {media.collectionTitle ? (
            <DetailPill
              label="Collection"
              value={media.collectionTitle}
              href={media.collectionLinkUrl}
            />
          ) : null}
          {indexParts ? <DetailPill label="Index" value={indexParts} /> : null}
          {media.trackId ? <DetailPill label="Track ID" value={media.trackId} /> : null}
          {media.linkUrl ? <DetailPill label="Track Link" value="Open link" href={media.linkUrl} /> : null}
        </div>

        <div className="mt-5">
          <div className="h-2 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-300 via-cyan-300 to-sky-400"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <div className="mt-3 flex items-center justify-between text-sm text-slate-300">
            <span>{formatClock(displayedProgress)}</span>
            <span>{formatClock(durationSeconds)}</span>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between text-xs uppercase tracking-[0.18em] text-slate-400">
          <span>{props.reader.app?.name ?? props.reader.device?.name ?? "Unknown device"}</span>
          <span>{media.source ?? "unknown"}</span>
        </div>
      </div>
    </article>
  );
}

function DetailPill(props: { label: string; value: string; href?: string }) {
  const content = (
    <>
      <span className="media-pill__label">{props.label}</span>
      <span className="media-pill__value">{props.value}</span>
    </>
  );

  if (props.href) {
    return (
      <a
        className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-3 py-2 text-xs text-slate-200 transition hover:bg-white/[0.1]"
        href={props.href}
        target="_blank"
        rel="noreferrer"
      >
        {content}
      </a>
    );
  }

  return <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-3 py-2 text-xs text-slate-200">{content}</div>;
}
