import { useEffect, useMemo, useState } from "react";

import { LIVE_LISTEN_SENDER_WAVEFORM_URL } from "@/lib/config";
import type { WaveformPoint } from "./waveform-types";

type SenderWaveformSnapshot = {
  channels: number;
  frameMs: number;
  history: WaveformPoint[];
  metrics: {
    clockDrops?: number;
    droppedFrames?: number;
    lateTicks?: number;
    maxLateMs?: number;
    queued?: number;
    underruns?: number;
  };
  sampleRate: number;
  updatedAt: number;
};

export function useSenderWaveform() {
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<SenderWaveformSnapshot | null>(null);
  const history = useMemo(() => snapshot?.history ?? [], [snapshot]);

  useEffect(() => {
    let active = true;
    let timer: number | null = null;

    const poll = async () => {
      try {
        const response = await fetch(LIVE_LISTEN_SENDER_WAVEFORM_URL, { cache: "no-store" });
        if (!response.ok) throw new Error(`sender_waveform_failed:${response.status}`);
        const next = await response.json() as SenderWaveformSnapshot;
        if (!active) return;
        setSnapshot(next);
        setError(null);
      } catch (cause) {
        if (!active) return;
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    };

    void poll();
    timer = window.setInterval(() => void poll(), 250);
    return () => {
      active = false;
      if (timer !== null) window.clearInterval(timer);
    };
  }, []);

  return { error, history, snapshot, url: LIVE_LISTEN_SENDER_WAVEFORM_URL };
}
