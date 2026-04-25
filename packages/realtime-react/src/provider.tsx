import { createContext, useContext, useEffect, useMemo } from "react";
import type { ReactNode } from "react";

import { PulseRealtimeClient } from "./client";
import { MediaProgressTickProvider } from "./media";
import type { PulseRealtimeConfig } from "./types";

const PulseRealtimeContext = createContext<PulseRealtimeClient | null>(null);

export function PulseRealtimeProvider(props: {
  config: PulseRealtimeConfig;
  children: ReactNode;
}) {
  const client = useMemo(() => new PulseRealtimeClient(props.config), [
    props.config.baseUrl,
    props.config.workspaceId,
    props.config.siteId,
    props.config.readingHeartbeatMs,
    props.config.readingProgressThrottleMs,
    props.config.readingProgressDeltaPercent,
    props.config.sessionStorageKey,
    props.config.tabStorageKey,
    props.config.viewer?.kind,
    props.config.viewer?.userId,
    props.config.interactionActor?.kind,
    props.config.interactionActor?.userId,
  ]);

  useEffect(() => () => client.dispose(), [client]);

  return (
    <PulseRealtimeContext.Provider value={client}>
      <MediaProgressTickProvider>{props.children}</MediaProgressTickProvider>
    </PulseRealtimeContext.Provider>
  );
}

export function usePulseRealtimeClient() {
  const client = useContext(PulseRealtimeContext);
  if (!client) {
    throw new Error("usePulseRealtimeClient must be used inside PulseRealtimeProvider");
  }
  return client;
}
