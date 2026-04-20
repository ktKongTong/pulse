import { Link, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { useMemo } from "react";

import { RealtimeObservabilityPanel } from "../components/realtime-observability-panel";
import { StatCard } from "../components/stat-card";
import { articleBySlug, type DemoArticle } from "../lib/articles";
import {
  useGlobalStatus,
  usePageStatus,
  useRealtimeDebugState,
} from "@pulse/realtime-react";
import { currentArticleUrl } from "../lib/realtime";
import { useArticlePresence } from "@/lib/hooks";

export function loader({ params }: LoaderFunctionArgs) {
  const article = articleBySlug(params.slug ?? "");
  if (!article) {
    throw new Response("Not found", { status: 404 });
  }
  return article;
}

export function ArticleRoute() {
  const article = useLoaderData() as DemoArticle;
  const canonicalUrl = useMemo(
    () => currentArticleUrl(article.slug),
    [article.slug],
  );
  useArticlePresence({
    title: article.title,
    url: canonicalUrl,
    canonicalUrl,
  });

  const debug = useRealtimeDebugState();
  const { data: pageStatus } = usePageStatus(canonicalUrl);
  const { data: globalStatus } = useGlobalStatus();

  const readers = pageStatus?.sessions ?? [];

  return (
    <main className="mx-auto max-w-7xl px-6 py-10 md:px-10 md:py-14">
      <header className="overflow-hidden rounded-[2.5rem] border border-white/80 bg-white/70 px-8 py-10 shadow-[0_35px_110px_rgba(15,23,42,0.10)] backdrop-blur-xl md:px-12 md:py-14">
        <div>
          <Link
            className="inline-flex items-center rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:-translate-y-0.5 hover:bg-slate-50"
            to="/"
          >
            Back to overview
          </Link>
          <p className="mt-6 text-[0.68rem] font-semibold uppercase tracking-[0.28em] text-slate-500">
            Article room
          </p>
          <h1 className="mt-3 max-w-4xl font-display text-5xl font-bold leading-[0.98] tracking-tight text-slate-950 md:text-6xl">
            {article.title}
          </h1>
          <p className="mt-4 max-w-3xl text-base leading-8 text-slate-600">
            {article.author} · {article.excerpt}
          </p>
        </div>
      </header>

      <section className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_420px] xl:items-start">
        <article className="space-y-6 rounded-[2rem] border border-white/80 bg-white/72 p-8 text-lg leading-8 text-slate-700 shadow-[0_26px_80px_rgba(15,23,42,0.08)] backdrop-blur-xl">
          {article.paragraphs.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </article>

        <aside className="space-y-6 xl:sticky xl:top-8">
          <div className="grid gap-4">
            <StatCard
              title="Page room"
              value={`${pageStatus?.sessionCount ?? 0} readers`}
              secondary="Live readers on this article right now."
            />
            <StatCard
              title="Global online"
              value={`${globalStatus?.sessionCount ?? 0}`}
              secondary="Readers across the whole site."
            />
          </div>

          <RealtimeObservabilityPanel debug={debug} />

          <section className="overflow-hidden rounded-[2rem] border border-white/80 bg-white/72 p-6 shadow-[0_26px_80px_rgba(15,23,42,0.08)] backdrop-blur-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[0.68rem] font-semibold uppercase tracking-[0.28em] text-slate-500">
                  Active readers
                </p>
                <h2 className="mt-2 font-display text-3xl font-bold tracking-tight text-slate-950">
                  This article
                </h2>
              </div>
            </div>
            {readers.length === 0 ? (
              <p className="mt-6 text-sm text-slate-500">
                Open another browser window on this article to see reader
                presence.
              </p>
            ) : (
              <div className="mt-6 space-y-3">
                {readers.map((reader) => (
                  <article
                    key={reader.id}
                    className="flex items-start justify-between gap-4 rounded-[1.5rem] border border-slate-200/70 bg-slate-50/80 px-5 py-4"
                  >
                    <div>
                      <h3 className="text-lg font-semibold text-slate-950">
                        {reader.userName ?? reader.id}
                      </h3>
                      <p className="mt-1 text-sm text-slate-500">
                        Active reading session
                      </p>
                    </div>
                    <div className="text-right text-sm text-slate-500">
                      <span className="block text-base font-semibold text-slate-950">
                        {reader.progress?.percent ?? 0}%
                      </span>
                      <small>{reader.userId ?? "anonymous"}</small>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </aside>
      </section>
    </main>
  );
}
