import { useEffect, useMemo, useState, type RefObject } from "react";

import type { WaveformPoint } from "./waveform-types";

export function useAudioWaveform(args: {
  audioRef?: RefObject<HTMLAudioElement | null>;
  audioTrack?: MediaStreamTrack | null;
  bins?: number;
  enabled?: boolean;
}) {
  const bins = args.bins ?? 48;
  const empty = useMemo<WaveformPoint[]>(
    () => Array.from({ length: bins }, (_, seq) => ({ peak: 0, rms: 0, seq, timestamp: 0 })),
    [bins],
  );
  const [history, setHistory] = useState<WaveformPoint[]>(empty);

  useEffect(() => {
    if (!args.enabled) {
      setHistory(empty);
      return;
    }

    const audioContext = new AudioContext();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.8;
    const source = args.audioTrack
      ? audioContext.createMediaStreamSource(new MediaStream([args.audioTrack]))
      : (() => {
          const audioElement = args.audioRef?.current;
          if (!audioElement) return null;
          return audioContext.createMediaElementSource(audioElement);
        })();
    if (!source) {
      setHistory(empty);
      void audioContext.close().catch(() => undefined);
      return;
    }
    source.connect(analyser);

    const buffer = new Uint8Array(analyser.fftSize);
    let frame = 0;
    let seq = 0;
    let rafId = 0;
    let disposed = false;

    const render = () => {
      if (disposed) return;
      analyser.getByteTimeDomainData(buffer);
      frame += 1;
      if (frame % 2 === 0) {
        const point = measureWaveform(buffer, seq);
        seq += 1;
        setHistory((current) => {
          const next = [...current, point];
          if (next.length > bins) next.splice(0, next.length - bins);
          return next;
        });
      }
      rafId = window.requestAnimationFrame(render);
    };

    void audioContext.resume().catch(() => undefined);
    rafId = window.requestAnimationFrame(render);

    return () => {
      disposed = true;
      window.cancelAnimationFrame(rafId);
      source.disconnect();
      analyser.disconnect();
      void audioContext.close().catch(() => undefined);
    };
  }, [args.audioRef, args.audioTrack, args.enabled, bins, empty]);

  return history;
}

function measureWaveform(buffer: Uint8Array, seq: number): WaveformPoint {
  let peak = 0;
  let energy = 0;
  for (let sampleIndex = 0; sampleIndex < buffer.length; sampleIndex += 1) {
    const centered = ((buffer[sampleIndex] ?? 128) - 128) / 128;
    const absolute = Math.abs(centered);
    peak = Math.max(peak, absolute);
    energy += centered * centered;
  }
  const rms = buffer.length > 0 ? Math.sqrt(energy / buffer.length) : 0;
  return { peak, rms, seq, timestamp: Date.now() };
}
