import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type ConnectionState = "idle" | "connecting" | "connected" | "error";

type MediaRoomSnapshot = {
  roomId: string;
  openedAt: string;
  producers: number;
  consumers: number;
  observers: number;
  nextSeq: number;
  latestSeq: number;
  availableFromSeq: number;
  bufferedChunks: number;
  bufferedSeconds: number;
  ringBufferSeconds: number;
  totalBytesIn: number;
  totalBytesOut: number;
  totalChunksIn: number;
  totalChunksOut: number;
  totalReplayChunks: number;
  totalReplayMisses: number;
  lastChunkBytes: number;
  lastChunkAt: string | null;
  zeroConsumersSinceMs?: number | null;
  zeroConsumerGraceMs?: number;
};

type TelemetryMessage = {
  protocol?: string;
  kind?: string;
  at?: string;
  type?: string;
  event?: Record<string, unknown>;
  snapshot?: MediaRoomSnapshot;
};

const ROOM_ID = "room-test-1";
const MAX_EVENTS = 80;

export default function MediaRoomDebugRoute() {
  const [connectionState, setConnectionState] = useState<ConnectionState>("idle");
  const [snapshot, setSnapshot] = useState<MediaRoomSnapshot | null>(null);
  const [events, setEvents] = useState<TelemetryMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<WebSocket | null>(null);

  const connect = useCallback(() => {
    if (socketRef.current && socketRef.current.readyState <= WebSocket.OPEN) return;
    setConnectionState("connecting");
    setError(null);
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${protocol}//${window.location.host}/api/v1/media-room/${ROOM_ID}?role=observer`);
    socketRef.current = socket;

    socket.onopen = () => {
      setConnectionState("connected");
      socket.send("stats");
    };
    socket.onclose = () => {
      socketRef.current = null;
      setConnectionState("idle");
    };
    socket.onerror = () => {
      setConnectionState("error");
      setError("observer_ws_error");
    };
    socket.onmessage = (event) => {
      if (typeof event.data !== "string") return;
      try {
        const message = JSON.parse(event.data) as TelemetryMessage;
        if (message.snapshot) setSnapshot(message.snapshot);
        setEvents((current) => [message, ...current].slice(0, MAX_EVENTS));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    };
  }, []);

  const disconnect = useCallback(() => {
    socketRef.current?.close(1000, "observer leave");
    socketRef.current = null;
    setConnectionState("idle");
  }, []);

  useEffect(() => () => disconnect(), [disconnect]);

  const rates = useMemo(() => {
    if (!snapshot) return { inbound: "-", outbound: "-" };
    const ageSeconds = Math.max(1, (Date.now() - Date.parse(snapshot.openedAt)) / 1000);
    return {
      inbound: `${((snapshot.totalBytesIn * 8) / ageSeconds / 1000).toFixed(1)}kbps`,
      outbound: `${((snapshot.totalBytesOut * 8) / ageSeconds / 1000).toFixed(1)}kbps`,
    };
  }, [snapshot]);

  return (
    <main style={styles.page}>
      <section style={styles.shell}>
        <header style={styles.header}>
          <div>
            <p style={styles.eyebrow}>Pulse Media Room Observatory</p>
            <h1 style={styles.title}>DO 音频中继观测台</h1>
            <p style={styles.description}>
              以 <code>observer</code> 角色连接 MediaRoomDO，只接收 telemetry 和 snapshot；不会计入 listener count，也不会触发 Live Listen 启停。
            </p>
          </div>
          <div style={styles.actions}>
            <button type="button" onClick={connect} disabled={connectionState === "connecting" || connectionState === "connected"} style={styles.primaryButton}>
              {connectionState === "connecting" ? "Connecting" : "Connect Observer"}
            </button>
            <button type="button" onClick={disconnect} disabled={connectionState !== "connected"} style={styles.secondaryButton}>
              Disconnect
            </button>
          </div>
        </header>

        <div style={styles.statusBar}>
          <span style={{ ...styles.pill, ...(connectionState === "connected" ? styles.pillLive : null) }}>{connectionState}</span>
          <span>room: {ROOM_ID}</span>
          <span>in: {rates.inbound}</span>
          <span>out: {rates.outbound}</span>
          {error ? <span style={styles.errorText}>{error}</span> : null}
        </div>

        <section style={styles.grid}>
          <Metric label="Producers" value={snapshot?.producers ?? "-"} />
          <Metric label="Consumers" value={snapshot?.consumers ?? "-"} />
          <Metric label="Observers" value={snapshot?.observers ?? "-"} />
          <Metric label="Latest Seq" value={snapshot?.latestSeq ?? "-"} />
          <Metric label="Available From" value={snapshot?.availableFromSeq ?? "-"} />
          <Metric label="Buffered" value={snapshot ? `${snapshot.bufferedChunks} / ${snapshot.bufferedSeconds.toFixed(1)}s` : "-"} />
          <Metric label="Chunks In" value={snapshot?.totalChunksIn ?? "-"} />
          <Metric label="Chunks Out" value={snapshot?.totalChunksOut ?? "-"} />
          <Metric label="Replay" value={snapshot ? `${snapshot.totalReplayChunks} chunks / ${snapshot.totalReplayMisses} miss` : "-"} />
          <Metric label="Zero Consumer" value={snapshot?.zeroConsumersSinceMs ? `${zeroConsumerAge(snapshot).toFixed(1)}s / ${((snapshot.zeroConsumerGraceMs ?? 0) / 1000).toFixed(1)}s` : "-"} />
          <Metric label="Bytes In" value={formatBytes(snapshot?.totalBytesIn ?? 0)} />
          <Metric label="Bytes Out" value={formatBytes(snapshot?.totalBytesOut ?? 0)} />
          <Metric label="Last Chunk" value={snapshot ? `${formatBytes(snapshot.lastChunkBytes)} · ${formatTime(snapshot.lastChunkAt)}` : "-"} />
        </section>

        <section style={styles.eventPanel}>
          <div style={styles.panelHeader}>
            <h2 style={styles.panelTitle}>Telemetry Stream</h2>
            <span style={styles.muted}>{events.length} events</span>
          </div>
          <div style={styles.eventList}>
            {events.length === 0 ? <p style={styles.empty}>尚未收到事件。连接 observer 后，producer/consumer/chunk/replay 事件会出现在这里。</p> : null}
            {events.map((event, index) => (
              <article key={`${event.at ?? "event"}-${index}`} style={styles.eventItem}>
                <div style={styles.eventMeta}>
                  <strong>{String(event.event?.type ?? event.type ?? event.kind ?? "message")}</strong>
                  <span>{formatTime(event.at ?? null)}</span>
                </div>
                <pre style={styles.pre}>{JSON.stringify(event.event ?? event, null, 2)}</pre>
              </article>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={styles.metric}>
      <dt style={styles.metricLabel}>{label}</dt>
      <dd style={styles.metricValue}>{value}</dd>
    </div>
  );
}

function zeroConsumerAge(snapshot: MediaRoomSnapshot) {
  if (!snapshot.zeroConsumersSinceMs) return 0;
  return Math.max(0, Date.now() - snapshot.zeroConsumersSinceMs) / 1000;
}

function formatBytes(value: number) {
  if (value < 1024) return `${value}B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)}KiB`;
  return `${(value / 1024 / 1024).toFixed(1)}MiB`;
}

function formatTime(value: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleTimeString();
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    background: "radial-gradient(circle at top left, rgba(16,185,129,0.18), transparent 34%), #0b0f0e",
    color: "#e8fff6",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    padding: 28,
  },
  shell: {
    maxWidth: 1180,
    margin: "0 auto",
    display: "flex",
    flexDirection: "column",
    gap: 20,
  },
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 24,
    border: "1px solid rgba(232,255,246,0.14)",
    borderRadius: 28,
    padding: 28,
    background: "rgba(255,255,255,0.05)",
  },
  eyebrow: {
    margin: 0,
    color: "#34d399",
    letterSpacing: "0.22em",
    textTransform: "uppercase",
    fontSize: 12,
    fontWeight: 800,
  },
  title: {
    margin: "12px 0",
    fontSize: 42,
    lineHeight: 1,
  },
  description: {
    maxWidth: 720,
    margin: 0,
    color: "rgba(232,255,246,0.68)",
    lineHeight: 1.7,
  },
  actions: {
    display: "flex",
    gap: 10,
    flexShrink: 0,
  },
  primaryButton: {
    border: 0,
    borderRadius: 999,
    padding: "12px 18px",
    background: "#34d399",
    color: "#03110c",
    fontWeight: 900,
    cursor: "pointer",
  },
  secondaryButton: {
    border: "1px solid rgba(232,255,246,0.18)",
    borderRadius: 999,
    padding: "12px 18px",
    background: "rgba(255,255,255,0.06)",
    color: "#e8fff6",
    fontWeight: 800,
    cursor: "pointer",
  },
  statusBar: {
    display: "flex",
    flexWrap: "wrap",
    gap: 16,
    alignItems: "center",
    color: "rgba(232,255,246,0.68)",
    fontSize: 13,
  },
  pill: {
    border: "1px solid rgba(232,255,246,0.16)",
    borderRadius: 999,
    padding: "8px 14px",
    textTransform: "uppercase",
    letterSpacing: "0.16em",
  },
  pillLive: {
    background: "rgba(52,211,153,0.16)",
    color: "#6ee7b7",
    borderColor: "rgba(52,211,153,0.4)",
  },
  errorText: {
    color: "#fca5a5",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
    gap: 12,
  },
  metric: {
    border: "1px solid rgba(232,255,246,0.12)",
    borderRadius: 18,
    padding: 16,
    background: "rgba(0,0,0,0.22)",
  },
  metricLabel: {
    color: "rgba(232,255,246,0.48)",
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: "0.14em",
  },
  metricValue: {
    margin: "10px 0 0",
    fontSize: 20,
    fontWeight: 900,
  },
  eventPanel: {
    border: "1px solid rgba(232,255,246,0.12)",
    borderRadius: 24,
    background: "rgba(0,0,0,0.26)",
    overflow: "hidden",
  },
  panelHeader: {
    display: "flex",
    justifyContent: "space-between",
    padding: "18px 20px",
    borderBottom: "1px solid rgba(232,255,246,0.1)",
  },
  panelTitle: {
    margin: 0,
    fontSize: 16,
  },
  muted: {
    color: "rgba(232,255,246,0.48)",
  },
  eventList: {
    maxHeight: 520,
    overflow: "auto",
    padding: 16,
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  empty: {
    color: "rgba(232,255,246,0.54)",
  },
  eventItem: {
    border: "1px solid rgba(232,255,246,0.1)",
    borderRadius: 14,
    padding: 12,
    background: "rgba(255,255,255,0.035)",
  },
  eventMeta: {
    display: "flex",
    justifyContent: "space-between",
    marginBottom: 8,
    color: "#a7f3d0",
    fontSize: 12,
  },
  pre: {
    margin: 0,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    color: "rgba(232,255,246,0.7)",
    fontSize: 12,
  },
};
