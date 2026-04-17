declare global {
  interface Window {
    __PULSE_REALTIME_DEBUG__?: boolean;
  }
}

export interface PulseRealtimeLogger {
  debug: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

function globalDebugEnabled() {
  if (typeof window === "undefined") return false;
  return window.__PULSE_REALTIME_DEBUG__ === true;
}

export function createRealtimeLogger(debugEnabled = false): PulseRealtimeLogger {
  const shouldDebug = debugEnabled || globalDebugEnabled();

  return {
    debug: (...args: unknown[]) => {
      if (!shouldDebug) return;
      console.debug(...args);
    },
    warn: (...args: unknown[]) => {
      console.warn(...args);
    },
    error: (...args: unknown[]) => {
      console.error(...args);
    },
  };
}

export const logger = createRealtimeLogger(false);
