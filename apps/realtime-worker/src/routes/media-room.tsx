import { useLiveListen } from "@/components/features/status/live-listen/use-live-listen";

const ROOM_ID = "room-test-1";

export default function MediaRoomRoute() {
  const liveListen = useLiveListen();
  const isConnected = liveListen.connectionState === "connected" || liveListen.connectionState === "listening";

  return (
    <main style={styles.page}>
      <section style={styles.card}>
        <p style={styles.eyebrow}>Pulse Media Room · WebSocket Relay MVP</p>
        <h1 style={styles.title}>纯 WebSocket 音频接收端</h1>
        <p style={styles.description}>
          Consumer 通过 WebSocket 接收 Native/Producer 发送的 WAV 音频块，使用 Web Audio API
          解码并按时间线排队播放。MVP 固定房间为 <code>{ROOM_ID}</code>。
        </p>

        <div style={styles.actions}>
          <button type="button" onClick={liveListen.join} disabled={liveListen.connectionState === "joining" || isConnected} style={styles.primaryButton}>
            连接
          </button>
          <button type="button" onClick={liveListen.leave} disabled={!isConnected} style={styles.secondaryButton}>
            断开
          </button>
        </div>

        <dl style={styles.stats}>
          <div>
            <dt>连接状态</dt>
            <dd>{liveListen.connectionState}</dd>
          </div>
          <div>
            <dt>已接收 chunks</dt>
            <dd>{liveListen.stats.chunkCount}</dd>
          </div>
          <div>
            <dt>播放队列</dt>
            <dd>{liveListen.stats.queuedSeconds.toFixed(2)}s</dd>
          </div>
          <div>
            <dt>接收码率</dt>
            <dd>{liveListen.stats.receiveBitrateKbps?.toFixed(1) ?? "-"}kbps</dd>
          </div>
          <div>
            <dt>总字节</dt>
            <dd>{formatBytes(liveListen.stats.receivedBytes)}</dd>
          </div>
          <div>
            <dt>最近 chunk</dt>
            <dd>{formatBytes(liveListen.stats.lastChunkBytes)}</dd>
          </div>
        </dl>

        {liveListen.error ? <p style={styles.error}>{liveListen.error}</p> : null}
      </section>
    </main>
  );
}

function formatBytes(value: number) {
  if (value < 1024) return `${value}B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)}KiB`;
  return `${(value / 1024 / 1024).toFixed(1)}MiB`;
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    display: "grid",
    placeItems: "center",
    background: "#111111",
    color: "#f5f5f5",
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
    padding: 24,
  },
  card: {
    width: "min(720px, 100%)",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 28,
    padding: 32,
    background: "linear-gradient(145deg, rgba(255,255,255,0.08), rgba(255,255,255,0.03))",
    boxShadow: "0 24px 80px rgba(0,0,0,0.35)",
  },
  eyebrow: {
    margin: 0,
    color: "#5eead4",
    fontSize: 13,
    fontWeight: 700,
    letterSpacing: "0.18em",
    textTransform: "uppercase",
  },
  title: {
    margin: "18px 0 12px",
    fontSize: 44,
    lineHeight: 1,
  },
  description: {
    margin: 0,
    color: "rgba(245,245,245,0.72)",
    fontSize: 17,
    lineHeight: 1.7,
  },
  actions: {
    display: "flex",
    gap: 12,
    marginTop: 28,
  },
  primaryButton: {
    border: 0,
    borderRadius: 999,
    padding: "12px 22px",
    background: "#10b981",
    color: "#04110d",
    fontSize: 16,
    fontWeight: 800,
    cursor: "pointer",
  },
  secondaryButton: {
    border: "1px solid rgba(255,255,255,0.16)",
    borderRadius: 999,
    padding: "12px 22px",
    background: "rgba(255,255,255,0.08)",
    color: "#f5f5f5",
    fontSize: 16,
    fontWeight: 700,
    cursor: "pointer",
  },
  stats: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: 12,
    margin: "28px 0 0",
  },
  error: {
    marginTop: 20,
    color: "#fca5a5",
  },
};
