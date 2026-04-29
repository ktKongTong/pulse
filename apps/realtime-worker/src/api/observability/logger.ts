import type { Env } from "../config/env";
import { debugLoggingEnabled } from "../config/env";

type LogPayload = Error | Record<string, unknown> | string | number | boolean | null | undefined;

function normalizePayload(payload: LogPayload): unknown {
  if (payload instanceof Error) {
    return {
      name: payload.name,
      message: payload.message,
      stack: payload.stack,
    };
  }
  return payload;
}

export function createWorkerLogger(env: Env, scope: string) {
  const debugEnabled = debugLoggingEnabled(env);

  function format(message: string, payload?: LogPayload) {
    if (payload === undefined) return [`[${scope}] ${message}`];
    return [`[${scope}] ${message}`, normalizePayload(payload)];
  }

  return {
    debug(message: string, payload?: LogPayload) {
      if (!debugEnabled) return;
      console.debug(...format(message, payload));
    },
    info(message: string, payload?: LogPayload) {
      if (!debugEnabled) return;
      console.info(...format(message, payload));
    },
    warn(message: string, payload?: LogPayload) {
      console.warn(...format(message, payload));
    },
    error(message: string, payload?: LogPayload) {
      console.error(...format(message, payload));
    },
  };
}
