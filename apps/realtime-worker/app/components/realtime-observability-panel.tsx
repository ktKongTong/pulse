import type { RoomSubscriptionDebugState } from "@pulse/realtime-react";

export function RealtimeObservabilityPanel(props: { debug: RoomSubscriptionDebugState }) {
  const { debug } = props;

  return (
    <section className="overflow-hidden rounded-[2rem] border border-white/80 bg-slate-950/[0.94] p-6 text-white shadow-[0_35px_90px_rgba(15,23,42,0.18)]">
      <div className="flex items-start justify-between gap-6">
        <div className="space-y-2">
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.28em] text-emerald-300/80">Realtime transport</p>
          <h2 className="font-display text-3xl font-bold tracking-tight">Observability</h2>
          <p className="max-w-2xl text-sm leading-6 text-slate-300">
            Live view of websocket negotiation, active subscriptions, and latest room snapshots.
          </p>
        </div>
      </div>

      <div className="mt-6 grid gap-3 md:grid-cols-5">
        <Metric label="Mode" value={debug.activeMode} />
        <Metric label="Transport" value={debug.transport.status} />
        <Metric label="Protocol" value={debug.transport.selectedProtocol ?? "pending"} />
        <Metric label="Subscriptions" value={`${debug.subscriptions.length}`} />
        <Metric label="Last push" value={debug.lastSnapshotMeta ? "snapshot" : "idle"} />
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <div className="rounded-[1.5rem] border border-white/10 bg-white/[0.04] p-5">
          <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-300">Capabilities</h3>
          {debug.meta?.capabilities ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {Object.entries(debug.meta.capabilities).map(([key, value]) => (
                <span
                  key={key}
                  className={`inline-flex items-center rounded-full px-3 py-1.5 text-xs font-semibold tracking-wide ${
                    value ? "bg-emerald-400/20 text-emerald-200" : "bg-white/8 text-slate-300"
                  }`}
                >
                  {key}: {String(value)}
                </span>
              ))}
            </div>
          ) : (
            <p className="mt-4 text-sm text-slate-400">Meta not loaded yet.</p>
          )}
        </div>

        <div className="rounded-[1.5rem] border border-white/10 bg-white/[0.04] p-5">
          <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-300">Active subscriptions</h3>
          {debug.subscriptions.length === 0 ? (
            <p className="mt-4 text-sm text-slate-400">No active subscriptions.</p>
          ) : (
            <div className="mt-4 space-y-3">
              {debug.subscriptions.map((subscription) => (
                <article
                  key={subscription.subscriptionId}
                  className="flex items-start justify-between gap-4 rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3"
                >
                  <div>
                    <strong className="text-sm font-semibold text-white">{subscription.key}</strong>
                    <p className="mt-1 text-xs text-slate-400">{subscription.roomId}</p>
                  </div>
                  <div className="text-right text-xs text-slate-400">
                    <div className="font-medium uppercase tracking-wide text-slate-200">{subscription.mode}</div>
                    <small>{subscription.subscriptionId}</small>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-[1.5rem] border border-white/10 bg-white/[0.04] p-5">
          <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-300">Latest push</h3>
          {debug.lastSnapshotMeta ? (
            <div className="mt-4">
              <article className="flex items-start justify-between gap-4 rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
                <div>
                  <strong className="text-sm font-semibold text-white">{debug.lastSnapshotMeta.roomId}</strong>
                  <p className="mt-1 text-xs text-slate-400">{debug.lastSnapshotMeta.updatedAt}</p>
                </div>
                <div className="text-right text-xs text-slate-400">
                  <div className="font-medium text-slate-200">rev {debug.lastSnapshotMeta.revision}</div>
                  <small>{debug.lastSnapshotMeta.subscriptionId}</small>
                </div>
              </article>
            </div>
          ) : (
            <p className="mt-4 text-sm text-slate-400">No push received yet.</p>
          )}
        </div>

        <div className="rounded-[1.5rem] border border-white/10 bg-white/[0.04] p-5 lg:col-span-2">
          <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-300">Room transports</h3>
          {debug.transports.length === 0 ? (
            <p className="mt-4 text-sm text-slate-400">No active room transports.</p>
          ) : (
            <div className="mt-4 space-y-3">
              {debug.transports.map((transport) => (
                <article
                  key={transport.roomId}
                  className="flex items-start justify-between gap-4 rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3"
                >
                  <div>
                    <strong className="text-sm font-semibold text-white">{transport.roomId}</strong>
                    <p className="mt-1 text-xs text-slate-400">
                      {transport.status} · refs {transport.refCount}
                    </p>
                  </div>
                  <div className="text-right text-xs text-slate-400">
                    <div className="font-medium text-slate-200">
                      {transport.selectedProtocol ?? "pending"}
                    </div>
                    <small>{transport.lastMessageType ?? "idle"}</small>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-[1.5rem] border border-white/10 bg-white/[0.04] p-5">
          <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-300">Last error</h3>
          <p className="mt-4 text-sm text-slate-300">{debug.transport.lastError ?? "none"}</p>
        </div>
      </div>
    </section>
  );
}

function Metric(props: { label: string; value: string }) {
  return (
    <div className="rounded-[1.4rem] border border-white/10 bg-white/[0.05] p-4">
      <p className="text-[0.65rem] font-semibold uppercase tracking-[0.28em] text-slate-400">{props.label}</p>
      <h3 className="mt-3 text-3xl font-semibold tracking-tight text-white">{props.value}</h3>
    </div>
  );
}
