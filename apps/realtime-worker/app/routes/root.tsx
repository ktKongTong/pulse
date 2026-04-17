import { Link } from "react-router";
import { useMemo } from "react";

import { InteractionPanel } from "../components/interaction-panel";
import { LiveMediaPanel } from "../components/live-media-panel";
import { RealtimeObservabilityPanel } from "../components/realtime-observability-panel";
import { StatCard } from "../components/stat-card";
import { articles } from "../lib/articles";
import {
  useGlobalPresenceSnapshot,
  useInteractionStates,
  usePagePresence,
  useRealtimeDebugState,
} from "@pulse/realtime-react";

export function meta() {
  return [
    { title: "New React Router App" },
    { name: "description", content: "Welcome to React Router!" },
  ];
}
export default function RootLayout() {
  const pageContext = useMemo(
    () =>
      typeof window === "undefined"
        ? {
            title: "Pulse Realtime Demo",
            url: "/",
            canonicalUrl: "/",
          }
        : {
            title: "Pulse Realtime Demo",
            url: window.location.href,
            canonicalUrl: window.location.origin + "/",
          },
    [],
  );

  usePagePresence({
    title: pageContext.title,
    url: pageContext.url,
    canonicalUrl: pageContext.canonicalUrl,
  });

  const debug = useRealtimeDebugState();
  const { snapshot } = useGlobalPresenceSnapshot();
  const { items: interactionStates, error: interactionError } =
    useInteractionStates();
  const readers = snapshot?.activeReaders ?? [];
  const webReaders = readers.filter((reader) => reader.source === "web");
  const deviceReaders = readers.filter((reader) => reader.source === "device");
  const appleMusicReader = deviceReaders.find(
    (reader) => reader.media?.providerId === "apple-music",
  );
  const recommendation = appleMusicReader
    ? {
        provider: "apple-music" as const,
        uri:
          appleMusicReader.media?.trackId ??
          appleMusicReader.media?.title ??
          "apple-music:search",
        title: appleMusicReader.media?.title,
        artist: appleMusicReader.media?.artist,
        album: appleMusicReader.media?.album ?? undefined,
      }
    : {
        provider: "apple-music" as const,
        uri: "apple-music:search",
        title: "No Apple Music track available",
      };
  const interactionDisabled = !appleMusicReader;
  const interactionDisabledReason = appleMusicReader
    ? "Apple Music recommendations are resolved from local metadata and played in the background."
    : "No active Apple Music-backed PulseBar device is currently available. Spotify remains disabled because its system API steals focus.";

  const activePages = Object.entries(snapshot?.pageConcurrencyMap ?? {})
    .map(([canonicalUrl, count]) => ({
      canonicalUrl,
      title:
        readers.find((reader) => reader.page?.canonicalUrl === canonicalUrl)?.page
          ?.title ?? canonicalUrl,
      count,
    }))
    .sort((left, right) => right.count - left.count);

  return (
    <main className="mx-auto max-w-7xl px-6 py-10 md:px-10 md:py-14">
      <header className="relative overflow-hidden rounded-[2.5rem] border border-white/80 bg-white/70 px-8 py-10 shadow-[0_35px_110px_rgba(15,23,42,0.10)] backdrop-blur-xl md:px-12 md:py-14">
        <div className="absolute inset-y-0 right-0 hidden w-1/3 bg-[radial-gradient(circle_at_center,_rgba(16,185,129,0.18),_transparent_65%)] md:block" />
        <div className="relative grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-end">
          <div>
            <p className="text-[0.72rem] font-semibold uppercase tracking-[0.32em] text-slate-500">
              Pulse Realtime Demo
            </p>
            <h1 className="mt-5 max-w-4xl font-display text-5xl font-bold leading-[0.95] tracking-tight text-slate-950 md:text-7xl">
              Presence, readers, and live media on one atmospheric edge
              dashboard.
            </h1>
            <p className="mt-6 max-w-3xl text-base leading-8 text-slate-600 md:text-lg">
              The macOS app and this browser demo both stream into the same room
              model. Use the article routes to simulate readers and watch
              global/page rooms update in realtime.
            </p>
          </div>
          <div className="relative flex flex-wrap gap-3 lg:justify-end">
            {articles.map((article) => (
              <Link
                key={article.slug}
                className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-slate-800"
                to={`/article/${article.slug}`}
              >
                Open {article.title}
              </Link>
            ))}
          </div>
        </div>
      </header>

      <section className="mt-8 grid gap-4 md:grid-cols-3">
        <StatCard
          title="Global room"
          value={`${snapshot?.onlineCount ?? 0} online`}
          secondary="Combined device presence and active web readers."
        />
        <StatCard
          title="Web readers"
          value={`${webReaders.length}`}
          secondary="Anonymous reader sessions currently visible to the site."
        />
        <StatCard
          title="Device presence"
          value={`${deviceReaders.length}`}
          secondary="Foreground devices currently feeding presence.v2 snapshots."
        />
      </section>

      <section className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_420px]">
        <section className="overflow-hidden rounded-[2rem] border border-white/80 bg-white/72 p-6 shadow-[0_26px_80px_rgba(15,23,42,0.08)] backdrop-blur-xl">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.28em] text-slate-500">
                Active pages
              </p>
              <h2 className="mt-2 font-display text-3xl font-bold tracking-tight text-slate-950">
                Page rooms
              </h2>
            </div>
          </div>
          <div className="mt-6 space-y-3">
            {activePages.length === 0 ? (
              <p className="text-sm text-slate-500">
                No active web readers yet. Open an article tab to populate page
                rooms.
              </p>
            ) : (
              activePages.map((page) => (
                <article
                  key={page.canonicalUrl}
                  className="flex items-start justify-between gap-4 rounded-[1.5rem] border border-slate-200/70 bg-slate-50/80 px-5 py-4"
                >
                  <div>
                    <h3 className="text-lg font-semibold text-slate-950">
                      {page.title}
                    </h3>
                    <p className="mt-1 text-sm text-slate-500">
                      {page.canonicalUrl}
                    </p>
                  </div>
                  <div className="text-right text-sm text-slate-500">
                    <strong className="block text-base font-semibold text-slate-950">
                      {page.count} readers
                    </strong>
                    <span>{page.count} active sessions</span>
                  </div>
                </article>
              ))
            )}
          </div>
        </section>

        <div className="space-y-6">
          <RealtimeObservabilityPanel debug={debug} />
          <LiveMediaPanel readers={deviceReaders} />
          <InteractionPanel
            recommendation={recommendation}
            states={interactionStates}
            subtitle="Recommend the current Spotify track to the active PulseBar device. PulseBar decides locally whether to accept it."
            disabled={interactionDisabled}
            disabledReason={interactionDisabledReason}
          />
          {interactionError ? (
            <p className="error-copy">{interactionError}</p>
          ) : null}

          <section className="overflow-hidden rounded-[2rem] border border-white/80 bg-white/72 p-6 shadow-[0_26px_80px_rgba(15,23,42,0.08)] backdrop-blur-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[0.68rem] font-semibold uppercase tracking-[0.28em] text-slate-500">
                  Readers
                </p>
                <h2 className="mt-2 font-display text-3xl font-bold tracking-tight text-slate-950">
                  Active sessions
                </h2>
              </div>
            </div>
            <div className="mt-6 space-y-3">
              {readers.length === 0 ? (
                <p className="text-sm text-slate-500">No readers online yet.</p>
              ) : (
                readers.map((reader) => (
                  <article
                    key={reader.readerId}
                    className="flex items-start justify-between gap-4 rounded-[1.5rem] border border-slate-200/70 bg-slate-50/80 px-5 py-4"
                  >
                    <div>
                      <h3 className="text-lg font-semibold text-slate-950">
                        {reader.displayName}
                      </h3>
                      <p className="mt-1 text-sm text-slate-500">
                        {reader.page?.title ?? "No page"} ·{" "}
                        {reader.presenceState}
                      </p>
                    </div>
                    <div className="text-right text-sm text-slate-500">
                      <span className="block text-base font-semibold text-slate-950">
                        {reader.reading?.progressPercent ?? 0}%
                      </span>
                      <small>{reader.source}</small>
                    </div>
                  </article>
                ))
              )}
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}
