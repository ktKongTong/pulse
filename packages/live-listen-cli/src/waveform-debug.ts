import { createServer, type Server } from "node:http";

export type SenderWaveformPoint = {
  peak: number;
  rms: number;
  seq: number;
  timestamp: number;
};

export type SenderWaveformMetrics = {
  clockDrops?: number;
  droppedFrames?: number;
  lateTicks?: number;
  maxLateMs?: number;
  queued?: number;
  underruns?: number;
};

export type SenderWaveformSnapshot = {
  channels: number;
  frameMs: number;
  history: SenderWaveformPoint[];
  metrics: SenderWaveformMetrics;
  sampleRate: number;
  updatedAt: number;
};

export type SenderWaveformDebugServer = {
  close(): void;
  record(samples: Int16Array): void;
  updateMetrics(metrics: SenderWaveformMetrics): void;
  url: string;
};

export function createSenderWaveformDebugServer(args: {
  bindHost: string;
  channels: number;
  frameMs: number;
  historySize?: number;
  port: number;
  sampleRate: number;
}): SenderWaveformDebugServer {
  const historySize = Math.max(32, Math.floor(args.historySize ?? 240));
  const history: SenderWaveformPoint[] = [];
  let seq = 0;
  let updatedAt = Date.now();
  let metrics: SenderWaveformMetrics = {};

  const server = createServer((request, response) => {
    if (request.url !== "/waveform") {
      response.writeHead(404, corsHeaders());
      response.end("not_found");
      return;
    }
    const body: SenderWaveformSnapshot = {
      channels: args.channels,
      frameMs: args.frameMs,
      history,
      metrics,
      sampleRate: args.sampleRate,
      updatedAt,
    };
    response.writeHead(200, {
      ...corsHeaders(),
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    response.end(JSON.stringify(body));
  });

  server.listen(args.port, args.bindHost);

  return {
    close() {
      void closeServer(server);
    },
    record(samples) {
      let peak = 0;
      let energy = 0;
      for (let index = 0; index < samples.length; index += 1) {
        const normalized = Math.abs(samples[index] ?? 0) / 32768;
        peak = Math.max(peak, normalized);
        energy += normalized * normalized;
      }
      const rms = samples.length > 0 ? Math.sqrt(energy / samples.length) : 0;
      history.push({ peak, rms, seq, timestamp: Date.now() });
      seq += 1;
      if (history.length > historySize) history.splice(0, history.length - historySize);
      updatedAt = Date.now();
    },
    updateMetrics(nextMetrics) {
      metrics = { ...metrics, ...nextMetrics };
      updatedAt = Date.now();
    },
    url: `http://${args.bindHost}:${args.port}/waveform`,
  };
}

function closeServer(server: Server) {
  return new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}
