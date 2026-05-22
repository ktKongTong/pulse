import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import { PulseRealtimeV2Client } from "./client";
import type { PulseRealtimeV2Config } from "./types";

const PulseRealtimeV2Context = createContext<PulseRealtimeV2Client | null>(null);

export function PulseRealtimeV2Provider(props: {
  config: PulseRealtimeV2Config;
  children: ReactNode;
}) {
  const client = useMemo(() => new PulseRealtimeV2Client(props.config), [
    props.config.baseUrl,
    props.config.sdkVersion,
    props.config.sessionStorageKey,
    props.config.tabStorageKey,
    props.config.autoConnectCommon,
    props.config.autoConnectMedia,
  ]);

  useEffect(() => {
    if (props.config.autoConnectCommon !== false) {
      void client.connectCommon();
    }
    if (props.config.autoConnectMedia) {
      void client.connectMedia();
    }
    return () => client.dispose();
  }, [client, props.config.autoConnectCommon, props.config.autoConnectMedia]);

  return (
    <PulseRealtimeV2Context.Provider value={client}>
      {props.children}
    </PulseRealtimeV2Context.Provider>
  );
}

export function usePulseRealtimeV2Client() {
  const client = useContext(PulseRealtimeV2Context);
  if (!client) {
    throw new Error(
      "usePulseRealtimeV2Client must be used inside PulseRealtimeV2Provider",
    );
  }
  return client;
}
