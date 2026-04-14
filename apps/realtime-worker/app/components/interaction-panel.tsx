import { useMemo, useState } from "react";
import type { InteractionState } from "@pulse/realtime-protocol";
import { usePulseRealtimeClient } from "@pulse/realtime-react";

export function InteractionPanel(props: {
  title?: string;
  subtitle?: string;
  recommendation: {
    provider: "spotify" | "apple-music";
    uri: string;
    title?: string;
    artist?: string;
    album?: string;
  };
  states: InteractionState[];
  disabled?: boolean;
  disabledReason?: string;
}) {
  const client = usePulseRealtimeClient();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const items = useMemo(
    () =>
      [...props.states].sort(
        (left, right) =>
          Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
      ),
    [props.states],
  );

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await client.createTrackRecommendation(props.recommendation);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "interaction_request_failed",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="overflow-hidden rounded-[2rem] border border-white/80 bg-white/75 p-6 shadow-[0_24px_70px_rgba(15,23,42,0.08)] backdrop-blur-xl">
      <div className="flex items-start justify-between gap-6">
        <div className="space-y-2">
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.28em] text-slate-500">
            {props.title ?? "Interactions"}
          </p>
          <h2 className="font-display text-3xl font-bold tracking-tight text-slate-950">
            Recommend a track
          </h2>
          <p className="max-w-2xl text-sm leading-6 text-slate-600">
            {props.subtitle ??
              "Send a spotify:track recommendation to the current active PulseBar device."}
          </p>
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-4 rounded-[1.5rem] border border-slate-200/80 bg-slate-50/80 p-5 md:flex-row md:items-center md:justify-between">
        <div>
          <strong className="text-lg font-semibold text-slate-950">
            {props.recommendation.title ?? "Track recommendation"}
          </strong>
          <p className="mt-1 text-sm text-slate-500">
            {props.recommendation.uri}
          </p>
          {props.recommendation.artist || props.recommendation.album ? (
            <p className="mt-1 text-sm text-slate-500">
              {[props.recommendation.artist, props.recommendation.album]
                .filter(Boolean)
                .join(" · ")}
            </p>
          ) : null}
          {props.disabledReason ? (
            <p className="mt-3 max-w-xl text-sm leading-6 text-slate-500">
              {props.disabledReason}
            </p>
          ) : null}
        </div>
        <button
          className="inline-flex items-center justify-center rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
          disabled={submitting || props.disabled}
          onClick={submit}
        >
          {submitting ? "Sending…" : "Recommend track"}
        </button>
      </div>

      {error ? (
        <p className="mt-4 text-sm font-medium text-rose-600">{error}</p>
      ) : null}

      <div className="mt-6 space-y-3">
        {items.length === 0 ? (
          <p className="text-sm text-slate-500">No interaction requests yet.</p>
        ) : (
          items.map((item) => (
            <article
              key={item.requestId}
              className="flex items-start justify-between gap-4 rounded-[1.5rem] border border-slate-200/70 bg-white px-5 py-4"
            >
              <div>
                <h3 className="text-sm font-semibold text-slate-950">
                  {item.command.uri}
                </h3>
                <p className="mt-1 text-sm text-slate-500">
                  {item.status} · {item.targetDeviceId ?? "unassigned"}
                </p>
              </div>
              <div className="text-right text-xs text-slate-500">
                <div>{item.updatedAt}</div>
                {item.error ? (
                  <small className="mt-1 block font-medium text-rose-600">
                    {item.error.code}
                  </small>
                ) : null}
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}
