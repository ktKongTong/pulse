import {
  CLIENT_COMMON_WS_PROTOCOL,
  ClientSessionClaimResponseSchema,
} from "@ktfun/pulse-protocol";
import {
  getOrCreateTabId,
  readStoredSessionId,
  storeSessionId,
} from "./utils/storage";
import type { ClientIdentity, PulseRealtimeV2Config } from "./types";
import { resolveHttpUrl } from "./utils/url";

export const DEFAULT_SDK_VERSION = "v2-dev";

export function resolveSdkVersion(config: PulseRealtimeV2Config) {
  return config.sdkVersion ?? DEFAULT_SDK_VERSION;
}

export async function claimSession(
  config: PulseRealtimeV2Config,
): Promise<ClientIdentity> {
  const storedSessionId = readStoredSessionId(config);
  const tabId = getOrCreateTabId(config);
  if (storedSessionId) return { sessionId: storedSessionId, tabId };

  const response = await fetch(resolveHttpUrl(config.baseUrl, "/api/v1/client/session"), {
    headers: { "Content-Type": "application/json" },
    method: "POST",
    body: JSON.stringify({
      protocol: CLIENT_COMMON_WS_PROTOCOL,
      sdkVersion: resolveSdkVersion(config),
    }),
  });
  if (!response.ok) {
    throw new Error(`client_session_claim_failed:${response.status}`);
  }
  const parsed = ClientSessionClaimResponseSchema.parse(await response.json());
  storeSessionId(config, parsed.sessionId);
  return {
    sessionId: parsed.sessionId,
    tabId,
    user: parsed.user,
  };
}
